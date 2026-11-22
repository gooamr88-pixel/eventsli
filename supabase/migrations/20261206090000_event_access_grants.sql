-- ═══════════════════════════════════════════════════════════════════════════
-- Private events: an unlock remembered on the ACCOUNT (owner, 2026-11-22:
-- "all if I have session or permission, or ask again").
--
-- Unlocking a private event used to live only in a cookie on one browser, so
-- a signed-in guest was asked for the password again on their phone, or after
-- seven days. Now an unlock made while signed in is also written here, and the
-- API lets that account in on any device (services/eventAccess.js `allowed`).
--
-- `password_set_at` is the event's `access_password_set_at` at the time of the
-- unlock. A grant only counts while they still match, so changing the
-- password locks out every account that unlocked with the old one — exactly
-- as it already does for the cookie.
--
-- Written and read by the API's service role only.
-- Run AFTER 20261205090000_private_events.sql and BEFORE the code.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_access_grants (
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  password_set_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS event_access_grants_event_idx ON event_access_grants (event_id);

ALTER TABLE event_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_access_grants FROM PUBLIC, anon, authenticated;
