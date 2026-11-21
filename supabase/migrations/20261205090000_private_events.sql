-- ═══════════════════════════════════════════════════════════════════════════
-- Private events, behind a password (owner, 2026-11-22).
--
-- An organizer marks an event private and sets a password. Then:
--
--   * the event is left out of every public listing — /events, the homepage,
--     "near you", the VIP slider, the organizer's public page, the assistant,
--     the sitemap. Someone who was not sent the link does not find it.
--   * its page, seat map, ticket picker, sponsor and vendor pages ask for the
--     password first. Only the title, the cover and the organizer's name show
--     before it (so the person who was sent the link knows they are in the
--     right place); dates, venue, prices and tickets do not.
--   * holding seats or tickets needs the password too, so knowing the slug is
--     not a way around it.
--
-- The password is stored as a stretched hash (utils/crypto.js, the same as
-- private tables), never as itself. Unlocking hands the browser a signed
-- token that names `access_password_set_at`, so changing the password locks
-- out everybody who unlocked with the old one.
--
-- Run BEFORE the code: the public listings filter on `is_private`.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS access_password_set_at TIMESTAMPTZ,
  -- The organizer's own length rule for the password (owner, 2026-11-22):
  -- the shortest and longest it may be. NULL = the platform default, 4 to 100.
  -- The guest's password screen states the range.
  ADD COLUMN IF NOT EXISTS access_password_min SMALLINT,
  ADD COLUMN IF NOT EXISTS access_password_max SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_access_password_length_rule'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_access_password_length_rule CHECK (
      (access_password_min IS NULL OR access_password_min BETWEEN 1 AND 100)
      AND (access_password_max IS NULL OR access_password_max BETWEEN 1 AND 100)
      AND (access_password_min IS NULL OR access_password_max IS NULL
           OR access_password_min <= access_password_max)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_private_needs_password'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_private_needs_password
      CHECK (NOT is_private OR (access_password_hash IS NOT NULL AND access_password_set_at IS NOT NULL));
  END IF;
END $$;

-- The listings read published, public, upcoming events; this keeps that one
-- index scan rather than a filter over every published row.
CREATE INDEX IF NOT EXISTS events_public_listed_idx
  ON events (starts_at) WHERE status = 'published' AND is_private = false;

COMMENT ON COLUMN events.is_private IS
  'Hidden from every public listing; its pages and holds need the access password (services/eventAccess.js).';
COMMENT ON COLUMN events.access_password_hash IS
  'Stretched hash of the access password (utils/crypto.js). Never returned by any endpoint.';
COMMENT ON COLUMN events.access_password_set_at IS
  'When the password was last set. Access tokens carry it, so a new password revokes old unlocks.';
