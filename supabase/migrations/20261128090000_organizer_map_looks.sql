-- ═══════════════════════════════════════════════════════════════════════════
-- Saved seating-map looks (owner, 2026-11-18).
--
-- The Venue Builder's "Map look" panel lets an organizer style a map — floor,
-- walls, tables, labels, seat colours, label font — and save that look to
-- reuse on their next event. Saved looks belong to the ORGANIZER, not to one
-- map, so they live here: a short JSON list on the organizers row.
--
-- Each entry is { id, name, floor, wall, table, label, seat, accent, font },
-- cleaned by backend/services/mapLookService.js before it is written. The
-- check below is the database's own ceiling: an array of at most 12.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE. Only the map-looks endpoints read the
-- column; without it they answer an empty list and refuse to save, and the
-- editor still styles maps (the look itself is stored in the map's layout).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS map_looks JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizer_map_looks_bounded;
ALTER TABLE organizers ADD CONSTRAINT organizer_map_looks_bounded CHECK (
  jsonb_typeof(map_looks) = 'array' AND jsonb_array_length(map_looks) <= 12
);
