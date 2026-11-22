-- ═══════════════════════════════════════════════════════════════════════════
-- THE EVENT'S ADDRESS, IN FULL (2026-11-22).
--
-- The owner: "the address may be somewhere like a home — we need more details
-- about the address and the postal code, all optional if the place is unknown".
--
-- An event had a venue name, ONE street line, a city and a country. That is
-- enough for a theatre and not for a flat: "Apt 4B, ring 12, side door" had
-- nowhere to go, and neither had a postal code or a province, which a guest's
-- phone needs to route them and which Google reads from the event's
-- structured data.
--
--   venue_address_line2   apartment, suite, unit, floor, building
--   venue_region          province, state, county
--   venue_postal_code     postal or ZIP code, as written locally
--   venue_directions      how to find the door: "ring 12", "side entrance"
--
-- All four are optional, like the venue itself: since this migration a
-- ticketed event may also be published with its venue still to be announced
-- (submissionService) — only the city is required, because it is what puts
-- the event in "near me". Nullable, bounded, and never an empty string, so
-- `IS NULL` keeps meaning "not given".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_address_line2 TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_region TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_postal_code TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_directions TEXT;

ALTER TABLE events DROP CONSTRAINT IF EXISTS event_venue_address_line2_shape;
ALTER TABLE events ADD CONSTRAINT event_venue_address_line2_shape
  CHECK (venue_address_line2 IS NULL OR length(btrim(venue_address_line2)) BETWEEN 1 AND 120);

ALTER TABLE events DROP CONSTRAINT IF EXISTS event_venue_region_shape;
ALTER TABLE events ADD CONSTRAINT event_venue_region_shape
  CHECK (venue_region IS NULL OR length(btrim(venue_region)) BETWEEN 1 AND 120);

ALTER TABLE events DROP CONSTRAINT IF EXISTS event_venue_postal_code_shape;
ALTER TABLE events ADD CONSTRAINT event_venue_postal_code_shape
  CHECK (venue_postal_code IS NULL OR length(btrim(venue_postal_code)) BETWEEN 1 AND 20);

ALTER TABLE events DROP CONSTRAINT IF EXISTS event_venue_directions_shape;
ALTER TABLE events ADD CONSTRAINT event_venue_directions_shape
  CHECK (venue_directions IS NULL OR length(btrim(venue_directions)) BETWEEN 1 AND 500);

COMMENT ON COLUMN events.venue_address_line2 IS 'Apartment, suite, unit, floor or building. Optional.';
COMMENT ON COLUMN events.venue_region IS 'Province, state or county. Optional.';
COMMENT ON COLUMN events.venue_postal_code IS 'Postal or ZIP code as written locally. Optional.';
COMMENT ON COLUMN events.venue_directions IS 'How to find the door (ring 12, side entrance). Optional; shown to buyers.';

NOTIFY pgrst, 'reload schema';
