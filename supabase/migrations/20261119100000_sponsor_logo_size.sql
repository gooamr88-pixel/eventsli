-- ═══════════════════════════════════════════════════════════════════════════
-- Sponsor logo size (owner request 2026-11-15): "the ability to make sponsors'
-- logos large from the admin dashboard".
--
-- A size PER SPONSOR rather than one global setting, the way sponsorship
-- tiers work: a headline sponsor's logo can be shown larger than the rest of
-- the strip. Three steps, named rather than numeric, so the console offers
-- choices that always look right instead of a number that can break the row:
--
--   standard   the strip's normal tile
--   large      about a third bigger
--   xlarge     about three quarters bigger — the headline sponsor
--
-- Existing sponsors keep 'standard', so applying this changes nothing on the
-- page until an admin chooses otherwise.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS logo_size TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsor_logo_size_known;
ALTER TABLE sponsors
  ADD CONSTRAINT sponsor_logo_size_known CHECK (logo_size IN ('standard', 'large', 'xlarge'));
