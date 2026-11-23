-- ═══════════════════════════════════════════════════════════════════════════
-- THE ATTENDEE APP (2026-11-24).
--
-- The consumer "Eventsli" app (attendee/) — discover, save, book, carry the
-- ticket. Three things it needs that the website never stored on the server:
--
--   saved_events        the heart on an event. The website keeps saved slugs in
--                       localStorage; an app that is reinstalled, or a person
--                       with a phone AND a laptop, needs them on the account.
--   user_notifications  the in-app inbox: "your tickets are ready", "starts
--                       tomorrow", "cancelled", "moved". One row per person per
--                       fact, keyed so a retried webhook never writes two.
--   push_devices        Expo push tokens, so the same row reaches the lock
--                       screen. A token belongs to ONE account at a time: the
--                       phone that signs in as somebody else moves it.
--
-- And the session label: `attendee_app` beside `web` and `checkin_app`, so the
-- sessions list says which app a sign-in came from and either app can be
-- signed out alone.
--
-- All three tables are read and written by the API's service role only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Sessions ──────────────────────────────────────────────────────────────
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_client_known;
ALTER TABLE sessions ADD CONSTRAINT sessions_client_known
  CHECK (client IS NULL OR client IN ('web', 'checkin_app', 'attendee_app'));

-- ─── Saved events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_events (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- "Saved Events", newest first, is the only read by person; the event index
-- serves "who saved this" when an event is cancelled or moved.
CREATE INDEX IF NOT EXISTS saved_events_user_recent_idx ON saved_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_events_event_idx ON saved_events (event_id);

ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON saved_events FROM PUBLIC, anon, authenticated;

-- ─── Notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 400),
  -- What a tap opens. SET NULL, not CASCADE: "this event was cancelled" must
  -- outlive an event an admin later deletes.
  event_id    UUID REFERENCES events(id) ON DELETE SET NULL,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  -- "order:<id>:tickets", "event:<id>:reminder" … — the same fact is written
  -- once per person however many times the code that noticed it runs.
  dedupe_key  TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_kind_known CHECK (kind IN (
    'tickets_issued', 'ticket_received', 'event_reminder',
    'event_cancelled', 'event_moved', 'welcome'
  )),
  CONSTRAINT user_notifications_once UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx ON user_notifications (user_id, created_at DESC);
-- The unread badge counts only these, so the index holds only these.
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx ON user_notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_notifications FROM PUBLIC, anon, authenticated;

-- ─── Push devices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_devices (
  -- The token is the key: one phone install, one row, one owner at a time.
  token         TEXT PRIMARY KEY CHECK (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Expo answered DeviceNotRegistered (the app was uninstalled). Kept, not
  -- deleted, so a re-registration by the same install simply clears it.
  disabled_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices (user_id) WHERE disabled_at IS NULL;

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_devices FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE saved_events IS 'Events a person hearted in the attendee app. routes/meRoutes.js.';
COMMENT ON TABLE user_notifications IS 'The attendee app inbox; one row per person per fact (dedupe_key). services/attendeeNotifications.js.';
COMMENT ON TABLE push_devices IS 'Expo push tokens for the attendee app; one owner per token.';

NOTIFY pgrst, 'reload schema';
