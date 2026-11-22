-- ═══════════════════════════════════════════════════════════════════════════
-- WHOSE GUEST IS THIS? (2026-11-23)
--
-- The owner: "the organizer should know where each ticket buyer comes from and
-- from whom — as the guest says 'I come from the groom', and the groom gets an
-- email, or the bride and the bride gets an email".
--
-- HOSTS are the people a guest can come from: the groom and the bride, two
-- families, the departments of a company, the promoters of a night. The
-- organizer lists them per event, each with an optional email; at checkout the
-- buyer answers "Whose guest are you?", and the host they name is emailed
-- about the booking and keeps a private link to their own guest list.
--
--   event_hosts                 the hosts of one event
--   events.guest_of_mode        off | optional | required — whether checkout asks
--   events.guest_of_question    the question as the organizer words it
--   reservations.guest_of_host_id   the answer, given at checkout (before payment)
--   orders.guest_of_host_id     the same answer on the order — copied from the
--                               reservation by a trigger as the order is made,
--                               so no checkout or fulfilment function changes
--   orders.host_notified_at     the host was emailed about this order (once)
--
-- Each host has a short CODE for their own link (/e/<slug>?guestof=<code>),
-- which picks them at checkout, and a LINK VERSION: the organizer can reset a
-- host's guest-list link, which signs out every copy of the old one.
-- A host with bookings is never deleted — taken off the list instead.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_hosts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Where the booking emails go. Optional: a host may only be a choice.
  email         CITEXT CHECK (email IS NULL OR char_length(email) <= 254),
  notify        BOOLEAN NOT NULL DEFAULT true,
  code          TEXT NOT NULL CHECK (code ~ '^[a-z0-9-]{1,32}$'),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  link_version  INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, code)
);
CREATE INDEX IF NOT EXISTS event_hosts_event_idx ON event_hosts (event_id, sort_order);

ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_of_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_of_question TEXT;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_guest_of_mode_kind;
ALTER TABLE events ADD CONSTRAINT events_guest_of_mode_kind CHECK (guest_of_mode IN ('off', 'optional', 'required'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_guest_of_question_shape;
ALTER TABLE events ADD CONSTRAINT events_guest_of_question_shape
  CHECK (guest_of_question IS NULL OR char_length(btrim(guest_of_question)) BETWEEN 1 AND 120);

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_of_host_id UUID REFERENCES event_hosts(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_of_host_id UUID REFERENCES event_hosts(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS host_notified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_guest_of_idx ON orders (guest_of_host_id) WHERE guest_of_host_id IS NOT NULL;

-- The answer travels from the hold to the order as the order is created.
CREATE OR REPLACE FUNCTION orders_copy_guest_of()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.guest_of_host_id IS NULL AND NEW.reservation_id IS NOT NULL THEN
    SELECT r.guest_of_host_id INTO NEW.guest_of_host_id
      FROM reservations r
      JOIN event_hosts h ON h.id = r.guest_of_host_id AND h.event_id = NEW.event_id
     WHERE r.id = NEW.reservation_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS orders_copy_guest_of ON orders;
CREATE TRIGGER orders_copy_guest_of
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_copy_guest_of();

-- The API reads and writes hosts with the service role only.
ALTER TABLE event_hosts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_hosts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_hosts TO service_role;

COMMENT ON TABLE event_hosts IS 'Whose guest a buyer is (the groom, the bride, a department, a promoter). Emailed on each booking; services/guestOfService.js.';

NOTIFY pgrst, 'reload schema';
