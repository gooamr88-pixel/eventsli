-- ─────────────────────────────────────────────────────────────────────────────
-- Event cover art and browse categories.
--
-- Both exist for the same reason: until now the only way to reach an event was
-- to already have its link. `/public/events` gave the platform a listing, but a
-- listing of untitled grey rectangles filtered only by country and date is not
-- one anyone browses. These two columns are what a storefront is made of, and
-- they have to land BEFORE the frontend is designed around their absence —
-- retrofitting an image into a card grid means rebuilding the card grid.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Category ───────────────────────────────────────────────────────────────
-- An enum, matching the eleven already in the base schema, rather than free
-- text. A text column means "Music", "music" and "MUSIC" are three categories,
-- the filter matches none of them reliably, and the browse page cannot render a
-- fixed set of rails because it does not know what the set is.
--
-- Thirteen values, chosen against how buyers in CA/US actually browse rather
-- than how organizers describe themselves. Adding one later is
-- `ALTER TYPE event_category ADD VALUE` — safe on PG15+, but it cannot be used
-- in the same transaction that adds it, so a value and its first row are two
-- migrations.
CREATE TYPE event_category AS ENUM (
  'music',        -- concerts, gigs, tours
  'festival',
  'nightlife',
  'sports',
  'arts',         -- theatre, dance, exhibitions
  'comedy',
  'film',
  'food_drink',
  'business',     -- conferences, networking, trade
  'community',    -- meetups, causes, charity
  'education',    -- workshops, classes, talks
  'family',
  'other'
);

-- NOT NULL DEFAULT 'other' rather than nullable. A nullable category gives the
-- browse page a third state — matched, excluded, and uncategorised — which every
-- filter, count and rail then has to carry. 'other' is a real bucket an
-- organizer can see themselves sitting in, which is also the only pressure that
-- makes them pick a better one.
ALTER TABLE events
  ADD COLUMN category event_category NOT NULL DEFAULT 'other';

-- ─── Cover art ──────────────────────────────────────────────────────────────
-- Two columns, not one.
--
-- `cover_url` is what a client renders. `cover_path` is the object key inside
-- the storage bucket, kept so the previous image can be deleted when a new one
-- replaces it. Deriving the key by parsing it back out of the URL works right
-- up until the public prefix changes — a CDN in front, a bucket rename, a
-- project move — and then every delete silently targets nothing and the bucket
-- grows forever.
--
-- Nullable: an event without a cover is a normal draft, not an invalid row. The
-- listing renders a typographic placeholder built from the title.
ALTER TABLE events
  ADD COLUMN cover_url  TEXT,
  ADD COLUMN cover_path TEXT;

-- The two must move together. A URL with no path cannot be cleaned up; a path
-- with no URL is an orphaned object nothing points at. Enforced here rather
-- than in the controller, because a rule in a controller is one code path away
-- from not existing.
ALTER TABLE events
  ADD CONSTRAINT cover_url_and_path_together
  CHECK ((cover_url IS NULL) = (cover_path IS NULL));

-- ─── The browse index ───────────────────────────────────────────────────────
-- Partial on `published`, because that is the only status `/public/events` ever
-- reads and it is a small slice of the table. Ordered on starts_at to match the
-- listing's default sort, so the common query is an index scan rather than a
-- filter and a sort.
CREATE INDEX IF NOT EXISTS events_published_browse
  ON events (category, starts_at)
  WHERE status = 'published';

-- ─── The storage bucket ─────────────────────────────────────────────────────
-- Public READ: a cover appears on a public event page and inside every social
-- share card, and a crawler fetching an Open Graph image carries no session.
-- Writes are another matter entirely — they arrive only through a signed upload
-- URL the API mints, so the browser never holds a Supabase key or client.
--
-- Guarded on the schema existing. CI runs `supabase start` with
-- `[storage] enabled = false` (config.toml — it saves minutes of container
-- pulls per run), so an unguarded INSERT here would fail every migration check
-- on a stack that is deliberately not running storage.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'event-media',
      'event-media',
      true,
      5242880,                                             -- 5 MB
      ARRAY['image/jpeg', 'image/png', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE
      SET public             = EXCLUDED.public,
          file_size_limit    = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
