-- ═══════════════════════════════════════════════════════════════════════════
-- Organizer public profiles + messages from ticket holders (owner, 2026-11-18).
--
-- "Creating profile for each organizer showing all his events professionally"
-- and, on the bought-ticket page, "ability to message and see his profile
-- details".
--
--   · organizers gain a public face: an address (`slug`, /o/<slug>), a logo,
--     and contact details the organizer CHOOSES to publish. Nothing here is
--     filled in for them: an empty field is simply not shown. Their account
--     email stays private either way.
--   · organizer_messages records each message a ticket holder sends. The
--     message itself is emailed to the organizer with the buyer as reply-to;
--     this table is the record and the rate limit's memory.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE. The API reads these columns only in
-- the new profile/contact queries, and tolerates their absence everywhere
-- else, so listings, event pages and checkout never depend on this file.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS slug          TEXT,
  ADD COLUMN IF NOT EXISTS logo_path     TEXT,
  ADD COLUMN IF NOT EXISTS public_email  TEXT,
  ADD COLUMN IF NOT EXISTS public_phone  TEXT,
  ADD COLUMN IF NOT EXISTS website_url   TEXT,
  ADD COLUMN IF NOT EXISTS social_links  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── The address ────────────────────────────────────────────────────────────
-- Lowercase letters, digits and single hyphens; 2–60 characters. Built from
-- the brand name once, then stable: a rename does not move the page, because
-- links to it are already printed on posters and shared in chats.
CREATE OR REPLACE FUNCTION organizer_slug_base(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(left(btrim(regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 50), ''),
    'organizer'
  );
$$;

CREATE OR REPLACE FUNCTION organizer_unique_slug(p_name TEXT, p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT := btrim(organizer_slug_base(p_name), '-');
  candidate TEXT := base;
BEGIN
  IF length(candidate) < 2 THEN candidate := 'organizer'; base := candidate; END IF;
  -- Taken by somebody else: the brand name plus the start of this id, which
  -- is stable and never collides with a second organizer of the same name.
  IF EXISTS (SELECT 1 FROM organizers WHERE slug = candidate AND id <> p_id) THEN
    candidate := base || '-' || left(replace(p_id::text, '-', ''), 6);
  END IF;
  RETURN candidate;
END;
$$;

-- Every existing organizer gets an address now.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, display_name FROM organizers WHERE slug IS NULL ORDER BY created_at LOOP
    UPDATE organizers SET slug = organizer_unique_slug(r.display_name, r.id) WHERE id = r.id;
  END LOOP;
END;
$$;

-- And every new one, at creation.
CREATE OR REPLACE FUNCTION organizers_default_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := organizer_unique_slug(NEW.display_name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizers_default_slug ON organizers;
CREATE TRIGGER organizers_default_slug
  BEFORE INSERT ON organizers
  FOR EACH ROW EXECUTE FUNCTION organizers_default_slug();

CREATE UNIQUE INDEX IF NOT EXISTS organizers_slug_key ON organizers (slug);

ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizer_slug_shape;
ALTER TABLE organizers ADD CONSTRAINT organizer_slug_shape
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,59}$');

-- ── What they choose to publish ────────────────────────────────────────────
ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizer_public_fields_bounded;
ALTER TABLE organizers ADD CONSTRAINT organizer_public_fields_bounded CHECK (
  (logo_path    IS NULL OR length(logo_path) <= 300)
  AND (public_email IS NULL OR (length(public_email) <= 254 AND public_email LIKE '%_@_%'))
  AND (public_phone IS NULL OR length(public_phone) BETWEEN 5 AND 40)
  AND (website_url  IS NULL OR (length(website_url) <= 300 AND website_url ~* '^https?://'))
  AND jsonb_typeof(social_links) = 'object'
);

-- ── Messages from ticket holders ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizer_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  event_id      UUID REFERENCES events(id) ON DELETE SET NULL,
  order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
  sender_email  TEXT NOT NULL,
  sender_name   TEXT,
  body          TEXT NOT NULL,
  delivered     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organizer_message_body_bounded CHECK (length(btrim(body)) BETWEEN 2 AND 2000),
  CONSTRAINT organizer_message_name_bounded CHECK (sender_name IS NULL OR length(sender_name) <= 120)
);
CREATE INDEX IF NOT EXISTS organizer_messages_order_idx ON organizer_messages (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS organizer_messages_organizer_idx ON organizer_messages (organizer_id, created_at DESC);

ALTER TABLE organizer_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organizer_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizer_messages TO service_role;

REVOKE EXECUTE ON FUNCTION organizer_unique_slug(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION organizers_default_slug() FROM PUBLIC, anon, authenticated;
