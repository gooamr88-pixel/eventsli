-- ─────────────────────────────────────────────────────────────────────────────
-- The sponsor link CHECK could never pass.
--
-- 20260916100000 wrote it as:
--
--   CHECK (link_url IS NULL OR link_url ~* '^https?://[^[:space:]]{3,2000}$')
--
-- Postgres caps a POSIX bound at 255, so `{3,2000}` is not a large repetition —
-- it is an INVALID one, and the pattern raises
--
--   invalid regular expression: invalid repetition count(s)
--
-- The failure mode is the nastiest kind available in a migration: CREATE TABLE
-- accepted it, because a CHECK expression is only parsed as a regex when it is
-- EVALUATED. The constraint therefore existed, looked correct in the schema,
-- and turned the first attempt to save a sponsor into a 500.
--
-- Split into the two things it was trying to say. The regex checks the SHAPE
-- and has no bound at all; the length is a separate comparison, which is what
-- it should have been to begin with — a regex is a poor way to express "at most
-- 2000 characters" even where the bound is legal.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsor_link_is_http;

ALTER TABLE sponsors
  ADD CONSTRAINT sponsor_link_is_http
  CHECK (
    link_url IS NULL
    OR (link_url ~* '^https?://[^[:space:]]+$' AND length(link_url) BETWEEN 11 AND 2000)
  );
