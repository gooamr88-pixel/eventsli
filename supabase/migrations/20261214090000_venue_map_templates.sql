-- ═══════════════════════════════════════════════════════════════════════════
-- Venue map library (owner, 2026-11-24).
--
-- "A global library of seating map templates for popular venues and
-- locations … so organizers can easily find and use them instead of building
-- their maps from scratch. Organizers should also be able to save their own
-- maps as reusable templates." Owner's rule: every one of these is the MAP
-- ONLY — no ticket types, prices, add-ons or event details.
--
-- A row is one layout of one real venue ("Massey Hall — concert, end stage"):
-- the venue it belongs to (name, address, city, country, Google place id,
-- coordinates, kind) and a snapshot of the map — tables, rows, areas, walls,
-- the venue's size and look — taken by
-- backend/services/venueMapTemplateService.js.
--
--   scope 'platform'   Eventsli's library, managed by super admins. `status`
--                      decides who sees one: draft and hidden are admin-only,
--                      published is offered to every organizer.
--   scope 'organizer'  one organizer's own saved maps (organizer_id set).
--
-- Separate from event_templates (20261129090000), which copy a whole event
-- setup; these never carry anything but the room.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE: nothing else reads this table, and the
-- pages say the library is not switched on until it exists.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_map_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL CHECK (scope IN ('organizer', 'platform')),
  organizer_id     UUID REFERENCES organizers(id) ON DELETE CASCADE,

  -- The layout's own name, e.g. "Concert — end stage" or "Gala, 40 rounds".
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description      TEXT CHECK (description IS NULL OR char_length(description) <= 500),

  -- The real venue.
  venue_name       TEXT NOT NULL CHECK (char_length(venue_name) BETWEEN 2 AND 120),
  venue_address    TEXT CHECK (venue_address IS NULL OR char_length(venue_address) <= 300),
  city             TEXT CHECK (city IS NULL OR char_length(city) <= 120),
  region           TEXT CHECK (region IS NULL OR char_length(region) <= 120),
  country          TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  venue_place_id   TEXT CHECK (venue_place_id IS NULL OR char_length(venue_place_id) <= 300),
  venue_lat        DOUBLE PRECISION CHECK (venue_lat IS NULL OR venue_lat BETWEEN -90 AND 90),
  venue_lng        DOUBLE PRECISION CHECK (venue_lng IS NULL OR venue_lng BETWEEN -180 AND 180),
  venue_kind       TEXT NOT NULL DEFAULT 'other' CHECK (venue_kind IN (
                     'arena', 'stadium', 'theatre', 'concert_hall', 'ballroom', 'banquet_hall',
                     'conference', 'club', 'outdoor', 'other')),

  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
  featured         BOOLEAN NOT NULL DEFAULT false,
  -- "Checked against the venue": an admin compared the layout with the real room.
  verified         BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT NOT NULL DEFAULT 0,

  data             JSONB NOT NULL,
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Where the layout came from: an event's map, a seating-chart picture read
  -- by AI, or another template. `source_note` is the credit organizers see
  -- ("Based on the venue's published seating chart, 2026").
  source           TEXT NOT NULL DEFAULT 'event' CHECK (source IN ('event', 'image', 'template')),
  source_note      TEXT CHECK (source_note IS NULL OR char_length(source_note) <= 300),
  source_event_id  UUID REFERENCES events(id) ON DELETE SET NULL,
  copied_from_id   UUID REFERENCES venue_map_templates(id) ON DELETE SET NULL,

  use_count        INT NOT NULL DEFAULT 0,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_map_template_owner CHECK ((scope = 'organizer') = (organizer_id IS NOT NULL)),
  -- Both coordinates or neither, like events.venue_coords_together.
  CONSTRAINT venue_map_template_coords CHECK ((venue_lat IS NULL) = (venue_lng IS NULL)),
  -- One JSON object, and bounded: a 400-table map is about 150 KB.
  CONSTRAINT venue_map_template_data_bounded CHECK (
    jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 1000000
  )
);

CREATE INDEX IF NOT EXISTS venue_map_templates_organizer_idx
  ON venue_map_templates (organizer_id, updated_at DESC) WHERE scope = 'organizer';
CREATE INDEX IF NOT EXISTS venue_map_templates_platform_idx
  ON venue_map_templates (status, featured DESC, sort_order, venue_name) WHERE scope = 'platform';
-- "Eventsli has a map of this venue": matched on the Google place first.
CREATE INDEX IF NOT EXISTS venue_map_templates_place_idx
  ON venue_map_templates (venue_place_id) WHERE venue_place_id IS NOT NULL;

-- The API reads and writes this table with the service role only.
ALTER TABLE venue_map_templates ENABLE ROW LEVEL SECURITY;

-- "Used 12 times", counted in one statement so two organizers at once both count.
CREATE OR REPLACE FUNCTION bump_venue_map_template_use(p_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE venue_map_templates SET use_count = use_count + 1 WHERE id = p_id;
$$;
