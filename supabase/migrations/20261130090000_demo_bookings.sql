-- ═══════════════════════════════════════════════════════════════════════════
-- Book a demo (owner, 2026-11-19).
--
-- "We need to add this system with complete controlling from admin
-- dashboard": a public /demo page where a would-be organizer picks a day, a
-- time and fills a short form, and an admin console that sets the hours, the
-- form and the rules, and manages every booking.
--
-- The SETTINGS are not here: they are one JSON document in platform_settings
-- under the key 'demo_booking', read and cleaned by
-- backend/services/demo/demoSettings.js (which supplies every default, so the
-- feature works before an admin has saved anything).
--
-- Bookings are written ONLY through book_demo / move_demo_booking below, which
-- take one lock, re-check the slot and write in the same transaction. Two
-- people pressing "Book" on the last 3 pm at once get one booking and one
-- "that time was just taken" — never two demos on top of each other.
--
-- The booker's "change or cancel" link carries no stored secret: its token is
-- an HMAC of the booking id (backend/services/demo/demoLinks.js), so every
-- email can carry the same link and an older email's link keeps working.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE: nothing else reads this table.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS demo_bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('confirmed', 'completed', 'no_show', 'cancelled')),
  name               TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email              TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  phone              TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  company            TEXT CHECK (company IS NULL OR char_length(company) <= 200),
  topic              TEXT CHECK (topic IS NULL OR char_length(topic) <= 120),
  message            TEXT CHECK (message IS NULL OR char_length(message) <= 2000),
  -- The admin's own extra questions, { questionId: answer }, with the label
  -- the person saw kept beside it so a later rename does not orphan answers.
  answers            JSONB NOT NULL DEFAULT '[]'::jsonb,
  booker_timezone    TEXT CHECK (booker_timezone IS NULL OR char_length(booker_timezone) <= 64),
  meeting_link       TEXT CHECK (meeting_link IS NULL OR char_length(meeting_link) <= 1000),
  host_notes         TEXT CHECK (host_notes IS NULL OR char_length(host_notes) <= 4000),
  assigned_to        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reminder_sent_at   TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN ('booker', 'admin')),
  cancel_reason      TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 500),
  rescheduled_from   TIMESTAMPTZ,
  reschedule_count   INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demo_booking_span CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '4 hours'),
  CONSTRAINT demo_booking_answers CHECK (jsonb_typeof(answers) = 'array' AND pg_column_size(answers) <= 20000)
);

CREATE INDEX IF NOT EXISTS demo_bookings_live_idx ON demo_bookings (starts_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS demo_bookings_start_idx ON demo_bookings (starts_at DESC);
CREATE INDEX IF NOT EXISTS demo_bookings_email_idx ON demo_bookings (lower(email));

-- The API reads and writes this table with the service role only.
ALTER TABLE demo_bookings ENABLE ROW LEVEL SECURITY;

-- ── Is a span free? ───────────────────────────────────────────────────────
-- Free when fewer than `p_capacity` live bookings overlap it (each padded by
-- the buffer on both sides), and — with a daily limit — the host day holds
-- fewer than the limit. `p_exclude` is the booking being moved.
CREATE OR REPLACE FUNCTION demo_slot_is_free(
  p_starts TIMESTAMPTZ, p_ends TIMESTAMPTZ, p_capacity INT, p_buffer_minutes INT,
  p_daily_limit INT, p_day_start TIMESTAMPTZ, p_day_end TIMESTAMPTZ, p_exclude UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT
    (SELECT count(*) FROM demo_bookings b
      WHERE b.status = 'confirmed'
        AND (p_exclude IS NULL OR b.id <> p_exclude)
        AND b.starts_at < p_ends + make_interval(mins => GREATEST(p_buffer_minutes, 0))
        AND b.ends_at + make_interval(mins => GREATEST(p_buffer_minutes, 0)) > p_starts
    ) < GREATEST(p_capacity, 1)
    AND (
      COALESCE(p_daily_limit, 0) <= 0
      OR (SELECT count(*) FROM demo_bookings b
           WHERE b.status = 'confirmed'
             AND (p_exclude IS NULL OR b.id <> p_exclude)
             AND b.starts_at >= p_day_start AND b.starts_at < p_day_end
         ) < p_daily_limit
    );
$$;

-- ── A new booking ─────────────────────────────────────────────────────────
-- One lock for the whole table: demos are a handful a day, and a single lock
-- is the simplest thing that is certainly right.
CREATE OR REPLACE FUNCTION book_demo(
  p_row JSONB, p_capacity INT, p_buffer_minutes INT,
  p_daily_limit INT, p_day_start TIMESTAMPTZ, p_day_end TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_starts TIMESTAMPTZ := (p_row->>'starts_at')::timestamptz;
  v_ends   TIMESTAMPTZ := (p_row->>'ends_at')::timestamptz;
  v_id     UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('demo_bookings'));
  IF NOT demo_slot_is_free(v_starts, v_ends, p_capacity, p_buffer_minutes, p_daily_limit, p_day_start, p_day_end, NULL) THEN
    RAISE EXCEPTION 'DEMO_SLOT_TAKEN';
  END IF;
  INSERT INTO demo_bookings (
    starts_at, ends_at, name, email, phone, company, topic, message, answers,
    booker_timezone, meeting_link
  ) VALUES (
    v_starts, v_ends, p_row->>'name', p_row->>'email', NULLIF(p_row->>'phone', ''),
    NULLIF(p_row->>'company', ''), NULLIF(p_row->>'topic', ''), NULLIF(p_row->>'message', ''),
    COALESCE(p_row->'answers', '[]'::jsonb), NULLIF(p_row->>'booker_timezone', ''),
    NULLIF(p_row->>'meeting_link', '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── Moving one ────────────────────────────────────────────────────────────
-- The same check, ignoring the booking itself. A reminder already sent for
-- the old time is forgotten so the new time gets its own.
CREATE OR REPLACE FUNCTION move_demo_booking(
  p_id UUID, p_starts TIMESTAMPTZ, p_ends TIMESTAMPTZ, p_capacity INT, p_buffer_minutes INT,
  p_daily_limit INT, p_day_start TIMESTAMPTZ, p_day_end TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_old TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('demo_bookings'));
  SELECT starts_at INTO v_old FROM demo_bookings WHERE id = p_id AND status = 'confirmed' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'DEMO_NOT_FOUND';
  END IF;
  IF NOT demo_slot_is_free(p_starts, p_ends, p_capacity, p_buffer_minutes, p_daily_limit, p_day_start, p_day_end, p_id) THEN
    RAISE EXCEPTION 'DEMO_SLOT_TAKEN';
  END IF;
  UPDATE demo_bookings
     SET starts_at = p_starts, ends_at = p_ends, rescheduled_from = v_old,
         reschedule_count = reschedule_count + 1, reminder_sent_at = NULL, updated_at = now()
   WHERE id = p_id;
END;
$$;
