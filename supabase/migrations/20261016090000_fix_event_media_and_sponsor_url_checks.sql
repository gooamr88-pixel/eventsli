-- ─────────────────────────────────────────────────────────────────────────────
-- The event gallery could never save a photo, and an event sponsor could never
-- save a link. The same bug, written a second time.
--
-- 20260916110000 fixed this exact CHECK on the homepage `sponsors` table:
--
--   url ~* '^https?://[^[:space:]]{3,2000}$'
--
-- Postgres caps a regex repetition bound at 255, so `{3,2000}` is not a large
-- bound — it is an INVALID one, and evaluating it raises
--
--   invalid regular expression: invalid repetition count(s)
--
-- The next day, 20260917120000 created `event_media` and `event_sponsors` with
-- the broken pattern copied in. CREATE TABLE accepts it, because a CHECK's regex
-- is only compiled when a row is checked — so:
--
--   · every INSERT into event_media failed: the organizer saw "Something went
--     wrong on our side" (a 500) under a toast that said "3 photos added", and no
--     gallery photo or video has ever been saved in production;
--   · every event sponsor WITH a link failed the same way. A sponsor without one
--     saved, because `link_url IS NULL OR …` never reached the regex.
--
-- Fixed the way the first one was: the regex checks the SHAPE and has no bound;
-- the length is a separate comparison. Both tables are empty of rows the old
-- check could have let through (it let none through), so re-adding validates
-- nothing that could fail.
--
-- backend/test/migrationRegex.test.js now refuses any migration with a regex
-- bound over 255, so a third copy fails CI instead of production.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE event_media DROP CONSTRAINT IF EXISTS media_url_is_http;
ALTER TABLE event_media
  ADD CONSTRAINT media_url_is_http
  CHECK (url ~* '^https?://[^[:space:]]+$' AND length(url) BETWEEN 11 AND 2000);

ALTER TABLE event_sponsors DROP CONSTRAINT IF EXISTS event_sponsor_link_is_http;
ALTER TABLE event_sponsors
  ADD CONSTRAINT event_sponsor_link_is_http
  CHECK (
    link_url IS NULL
    OR (link_url ~* '^https?://[^[:space:]]+$' AND length(link_url) BETWEEN 11 AND 2000)
  );
