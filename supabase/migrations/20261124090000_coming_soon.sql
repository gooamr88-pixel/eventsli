-- ═══════════════════════════════════════════════════════════════════════════
-- "Coming soon" events (owner request 2026-11-17).
--
-- An organizer announces an event before the details are final: a title, a
-- city, a cover and a rough date (a month) are enough to publish a teaser.
-- Buyers can leave their email to hear when tickets go on sale. Later the
-- organizer fills in the venue, the exact times, the tickets and the payment
-- and OPENS SALES, which runs the normal publish checks (and waits for an admin
-- when the platform requires approval).
--
-- ONE FLAG, NOT A NEW STATUS. A teaser goes through the review pipeline
-- (draft → published, or via pending_review) exactly like any other event; the
-- status machine is unchanged. `coming_soon` says what a PUBLISHED event is:
-- a page with a "Notify me" button instead of a Buy button.
--
--   coming_soon          true while it is a teaser
--   launch_requested_at  the organizer asked to open sales and the platform
--                        requires approval; an admin decides. The teaser stays
--                        public meanwhile.
--   sales_opened_at      when the teaser became an event on sale — what tells
--                        the notice job that the people waiting can be emailed.
--
-- THE ROUGH DATE NEEDS NO COLUMN. It is stored as the whole month at the venue
-- (00:00 on the 1st to 23:59 on the last day), the same way a date-only listing
-- is stored as whole days (frontend lib/dateOnly.js). The listing, the sitemap
-- and the "past events" cut-off keep reading starts_at/ends_at as they always
-- have, and a stale teaser drops off the listing when its month is over.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS coming_soon         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS launch_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_opened_at     TIMESTAMPTZ;

-- Only a teaser can be waiting for its sales to open.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_launch_request_is_a_teasers;
ALTER TABLE events
  ADD CONSTRAINT events_launch_request_is_a_teasers
  CHECK (launch_requested_at IS NULL OR coming_soon);

-- The admin queue reads waiting launch requests beside pending_review events.
CREATE INDEX IF NOT EXISTS events_launch_requested_idx
  ON events (launch_requested_at) WHERE launch_requested_at IS NOT NULL;

-- ── A teaser sells nothing ─────────────────────────────────────────────────
-- The API refuses a hold on a coming-soon event before it calls any sale
-- function (services/purchasability.js). This is the same rule where no code
-- path can step round it: every hold function, seat or general admission,
-- starts by inserting a reservation, and that insert is refused here.
CREATE OR REPLACE FUNCTION refuse_coming_soon_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND coming_soon) THEN
    RAISE EXCEPTION 'Tickets for this event are not on sale yet'
      USING ERRCODE = 'P0001', HINT = 'EVENT_COMING_SOON';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_refuse_coming_soon ON reservations;
CREATE TRIGGER reservations_refuse_coming_soon
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION refuse_coming_soon_reservation();

-- ── The "notify me" list ───────────────────────────────────────────────────
-- One row per address per event. A buyer asking twice is still one email.
--
-- `notified_at` is set once the "tickets are on sale" email has been handed to
-- the mail provider, so the job that sends them (services/comingSoonService.js)
-- can be run again after a crash without emailing anybody twice.
--
-- Private: service role only. Addresses are personal data; the organizer sees
-- a count, never the list.
CREATE TABLE IF NOT EXISTS event_notify_signups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email        CITEXT NOT NULL,
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ,

  CONSTRAINT event_notify_signups_one_per_address UNIQUE (event_id, email),
  CONSTRAINT event_notify_signups_email_shape CHECK (length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1)
);

-- The notice job's read: who on this event has not been told yet.
CREATE INDEX IF NOT EXISTS event_notify_signups_pending_idx
  ON event_notify_signups (event_id) WHERE notified_at IS NULL;

ALTER TABLE event_notify_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_notify_signups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_notify_signups TO service_role;
