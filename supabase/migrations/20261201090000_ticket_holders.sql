-- ═══════════════════════════════════════════════════════════════════════════
-- A name on every ticket (owner, 2026-11-19).
--
-- "When multiple tickets, multiple data for each one": on an order of two or
-- more tickets the checkout asks, per ticket, the holder's first name, last
-- name, phone and email (the owner's reference). Decided with the owner:
--
--   * each EVENT chooses — events.holder_details:
--       'required'  first name required on every ticket (the default, as the
--                   reference has it), the rest optional
--       'optional'  the forms are shown, nothing is required
--       'off'       no forms
--   * an order of ONE ticket shows no form: that ticket is the buyer's, and
--     is named from the buyer's own details.
--
-- The checkout writes the answers to reservation_holders before payment.
-- The tickets are written later, by whichever path pays (card fulfilment,
-- a free claim, the organizer confirming an offline payment), so one BEFORE
-- INSERT trigger names each ticket as it is created — none of those money
-- functions changes. A seat's ticket takes the holder entered for that seat;
-- general admission takes the next holder entered for that ticket type.
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE: with no holder rows the trigger
-- leaves every ticket exactly as it was.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS holder_details TEXT NOT NULL DEFAULT 'required'
    CHECK (holder_details IN ('required', 'optional', 'off'));

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attendee_phone TEXT
  CHECK (attendee_phone IS NULL OR char_length(attendee_phone) <= 30);

CREATE TABLE IF NOT EXISTS reservation_holders (
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  position        INT NOT NULL CHECK (position BETWEEN 1 AND 1000),
  seat_id         UUID,
  tier_id         UUID,
  first_name      TEXT CHECK (first_name IS NULL OR char_length(first_name) <= 60),
  last_name       TEXT CHECK (last_name IS NULL OR char_length(last_name) <= 60),
  phone           TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  email           CITEXT CHECK (email IS NULL OR char_length(email) <= 254),
  ticket_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, position)
);

-- The API reads and writes this table with the service role only.
ALTER TABLE reservation_holders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION apply_ticket_holder() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation UUID;
  v_holder reservation_holders%ROWTYPE;
  v_name TEXT;
BEGIN
  IF NEW.attendee_name IS NOT NULL THEN
    RETURN NEW;  -- a door sale or an import already named it
  END IF;
  SELECT reservation_id INTO v_reservation FROM orders WHERE id = NEW.order_id;
  IF v_reservation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT * INTO v_holder FROM reservation_holders
     WHERE reservation_id = v_reservation AND seat_id = NEW.seat_id AND ticket_id IS NULL
     ORDER BY position LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_holder FROM reservation_holders
     WHERE reservation_id = v_reservation AND seat_id IS NULL AND ticket_id IS NULL
       AND tier_id IS NOT DISTINCT FROM NEW.tier_id
     ORDER BY position LIMIT 1 FOR UPDATE;
  END IF;
  IF v_holder.reservation_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_name := NULLIF(btrim(concat_ws(' ', NULLIF(btrim(v_holder.first_name), ''), NULLIF(btrim(v_holder.last_name), ''))), '');
  NEW.attendee_name := v_name;
  NEW.attendee_email := COALESCE(NEW.attendee_email, v_holder.email);
  NEW.attendee_phone := COALESCE(NEW.attendee_phone, v_holder.phone);
  -- NEW.id is already set: column defaults apply before BEFORE triggers.
  UPDATE reservation_holders SET ticket_id = NEW.id
   WHERE reservation_id = v_holder.reservation_id AND position = v_holder.position;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_ticket_holder ON tickets;
CREATE TRIGGER trg_apply_ticket_holder
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION apply_ticket_holder();
