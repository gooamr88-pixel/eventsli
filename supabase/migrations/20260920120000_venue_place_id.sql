-- ═══════════════════════════════════════════════════════════════════════════
-- THE VENUE, AS GOOGLE KNOWS IT.
--
-- `events` already carries everything a page needs to RENDER a venue:
-- `venue_name`, `venue_address`, `city`, and the `venue_lat` / `venue_lng` pair
-- added by 20260917120000. What it has never carried is the one value that says
-- WHICH venue — a stable identifier that survives a rename, a re-typed address
-- and a organizer correcting their own spelling.
--
-- Until now those five columns were all typed by hand. The `city` migration
-- (20260916100000) said it plainly: "Geocoding can be added later against this
-- column; it cannot be added later against nothing." This is that later. The
-- create-event wizard now searches Google Places and writes all five at once
-- from one chosen result, and this column records which result it was.
--
-- ─── WHY STORE IT AT ALL ────────────────────────────────────────────────────
--
-- The four display columns are a SNAPSHOT: what the place was called on the day
-- somebody picked it. That is the right thing to show on a ticket, because a
-- ticket has to match the sign on the building as it was described when it was
-- bought. But a snapshot cannot be refreshed, deduplicated or joined:
--
--   · Two organizers running events at the same hall type its name two ways.
--     With a place id they are one venue; without, they are two strings.
--   · A venue is renamed. The id still resolves; the string is stale forever.
--   · "More events at this venue" is a GROUP BY on this column, and is not
--     expressible over free text at all.
--
-- None of those are built today. The column is here because it costs one TEXT
-- field to keep the option and it cannot be backfilled later — the wizard would
-- have to re-search on the organizer's behalf and guess which result they meant,
-- which is exactly the guess a stored id exists to avoid.
--
-- ─── DELIBERATELY NOT A FOREIGN KEY, AND NOT UNIQUE ─────────────────────────
--
-- There is no `venues` table and this does not create one. A place id is an
-- opaque string from a third party; promoting it to a key would mean this
-- schema has a row per Google place, kept in step with a service we do not own.
-- Many events share one venue, so a unique constraint would be wrong in the
-- ordinary case rather than the rare one.
--
-- ─── NULLABLE, AND MOST ROWS WILL STAY NULL ─────────────────────────────────
--
-- Every event that exists today has no place id, and so does every event whose
-- organizer typed the venue rather than picking a suggestion — which stays
-- fully supported. The wizard degrades to plain text inputs when the Places key
-- is absent (`GOOGLE_PLACES_API_KEY` is optional), so a deployment without one
-- behaves exactly as it does today. NOT NULL here would mean inventing a value
-- for all of them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_place_id TEXT;

-- A Google place id is an opaque token, historically ~27 characters but
-- explicitly documented as variable-length, so this bounds it rather than
-- pinning it: long enough for anything Google has issued, short enough that the
-- column cannot be used as free storage by a client that sends junk.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS event_venue_place_id_shape;
ALTER TABLE events
  ADD CONSTRAINT event_venue_place_id_shape
  CHECK (venue_place_id IS NULL OR length(btrim(venue_place_id)) BETWEEN 1 AND 255);

-- Partial: the only query that will ever read this is "other events at this
-- venue", which is a published-events question. Indexing the nulls would be
-- indexing most of the table for nobody.
CREATE INDEX IF NOT EXISTS events_published_venue_place
  ON events (venue_place_id, starts_at)
  WHERE status = 'published' AND venue_place_id IS NOT NULL;

COMMENT ON COLUMN events.venue_place_id IS
  'Google Places id for the chosen venue, or NULL when the organizer typed the '
  'venue by hand. Display always uses venue_name/venue_address/city, which are '
  'the snapshot taken when it was chosen; this is the stable identity behind them.';
