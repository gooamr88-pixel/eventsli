-- ═══════════════════════════════════════════════════════════════════════════
-- Event templates (owner, 2026-11-19).
--
-- "A professional system for each organizer to save his templates to use them
-- for new events, and templates of Eventsli shared with all organizers with
-- complete control from the super admin dashboard."
--
-- A template is a snapshot of an event's SETUP — its details, ticket types,
-- add-ons, table categories and seating map — taken by
-- backend/services/eventTemplateService.js. It never holds sales, buyers,
-- dates or images: a new event starts from it as a fresh draft.
--
--   scope 'organizer'  one organizer's own library (organizer_id set)
--   scope 'platform'   Eventsli's templates, shared with every organizer and
--                      managed by super admins only. `status` decides who sees
--                      one: draft and hidden are admin-only, published is live.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE: nothing else reads this table.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL CHECK (scope IN ('organizer', 'platform')),
  organizer_id     UUID REFERENCES organizers(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description      TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  category         TEXT,
  listing_type     TEXT NOT NULL DEFAULT 'ticketed' CHECK (listing_type IN ('ticketed', 'display_only')),
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
  featured         BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT NOT NULL DEFAULT 0,
  cover_url        TEXT CHECK (cover_url IS NULL OR char_length(cover_url) <= 1000),
  data             JSONB NOT NULL,
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_id  UUID REFERENCES events(id) ON DELETE SET NULL,
  copied_from_id   UUID REFERENCES event_templates(id) ON DELETE SET NULL,
  use_count        INT NOT NULL DEFAULT 0,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An organizer's template has its organizer; Eventsli's has none.
  CONSTRAINT event_template_owner CHECK ((scope = 'organizer') = (organizer_id IS NOT NULL)),
  -- One JSON object, and bounded: a 400-table map is about 150 KB.
  CONSTRAINT event_template_data_bounded CHECK (
    jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 1000000
  )
);

CREATE INDEX IF NOT EXISTS event_templates_organizer_idx
  ON event_templates (organizer_id, updated_at DESC) WHERE scope = 'organizer';
CREATE INDEX IF NOT EXISTS event_templates_platform_idx
  ON event_templates (status, featured DESC, sort_order, name) WHERE scope = 'platform';

-- The API reads and writes this table with the service role only.
ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;

-- "Used 12 times", counted in one statement so two organizers starting from
-- the same template at once both count.
CREATE OR REPLACE FUNCTION bump_event_template_use(p_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE event_templates SET use_count = use_count + 1 WHERE id = p_id;
$$;
