-- ═══════════════════════════════════════════════════════════════════════════
-- Atomic seat and table holds.
--
-- This is the one place in the system where two people genuinely race for the
-- same object, and the cost of getting it wrong is two buyers holding a ticket
-- for one chair. It lives in the database, as a function, because that is the
-- only place the check and the write can be a single indivisible act. The same
-- logic in the API would read "is it free?" and then "take it" as two
-- statements with a window between them — and that window is the bug.
--
-- ── THE LOCK ORDER, AND WHY IT IS WHAT IT IS ──
--
-- BRD §25 makes a table and its seats two views of one piece of stock. A buyer
-- taking the whole table competes with a buyer taking one seat inside it, and
-- the two arrive by different routes.
--
-- So: whenever the seats involved belong to a table, the TABLE ROW IS LOCKED
-- FIRST, and tables are locked in id order. Both halves matter —
--
--   • locking the table first serialises every operation that touches its
--     stock, whichever route it came in by;
--   • locking in a consistent ORDER means two transactions touching the same
--     two tables can never each hold what the other is waiting for.
--
-- Table rows use plain FOR UPDATE (wait, then re-read), because the second
-- buyer should see the outcome of the first rather than be told the table is
-- busy. Seat rows use SKIP LOCKED, because there the right answer IS "someone
-- else has it" and waiting only delays the same failure.
-- ═══════════════════════════════════════════════════════════════════════════

-- Seats reserved as part of a whole-table purchase point at the reservation
-- item that bought the table, so releasing the table releases them together.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS held_by_reservation UUID
  REFERENCES reservations(id) ON DELETE SET NULL;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS held_by_reservation UUID
  REFERENCES reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS seats_held_idx  ON seats  (held_by_reservation)
  WHERE held_by_reservation IS NOT NULL;
CREATE INDEX IF NOT EXISTS tables_held_idx ON tables (held_by_reservation)
  WHERE held_by_reservation IS NOT NULL;

-- ─── The effective price of one seat ───────────────────────────────────────
-- seat override → tier price. The table price is NOT part of this: BRD §25
-- makes it an independent number, not the sum of its seats.
CREATE OR REPLACE FUNCTION seat_price_cents(p_seat_id UUID)
RETURNS BIGINT AS $$
  SELECT COALESCE(s.price_override_cents, t.price_cents, 0)
  FROM seats s
  LEFT JOIN ticket_tiers t ON t.id = s.tier_id
  WHERE s.id = p_seat_id;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- hold_seats — reserve individual seats
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION hold_seats(
  p_event_id   UUID,
  p_user_id    UUID,          -- NULL for a guest checkout
  p_seat_ids   UUID[],
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_requested   INT;
  v_event       RECORD;
  v_table_ids   UUID[];
  v_locked      UUID[];
  v_locked_n    INT;
  v_res_id      UUID;
  v_expires     TIMESTAMPTZ;
  v_total       BIGINT := 0;
BEGIN
  v_requested := COALESCE(array_length(p_seat_ids, 1), 0);
  IF v_requested = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Select at least one seat.');
  END IF;

  SELECT id, status, purchase_mode, max_tickets_per_order, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  IF v_event.purchase_mode = 'table_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event sells whole tables only.');
  END IF;

  IF v_requested > v_event.max_tickets_per_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
      'message', format('You can buy at most %s tickets in one order.',
                        v_event.max_tickets_per_order));
  END IF;

  -- ── Lock the parent tables first, in id order. ──
  -- Nothing is read from this beyond the lock itself: its purpose is to make a
  -- whole-table buyer and a single-seat buyer take turns.
  SELECT array_agg(DISTINCT s.table_id ORDER BY s.table_id)
    INTO v_table_ids
    FROM seats s
   WHERE s.id = ANY(p_seat_ids) AND s.table_id IS NOT NULL;

  IF v_table_ids IS NOT NULL THEN
    PERFORM 1 FROM tables WHERE id = ANY(v_table_ids) ORDER BY id FOR UPDATE;
  END IF;

  -- ── Lock the seats themselves. ──
  -- The subquery is load-bearing: FOR UPDATE cannot be applied to a query with
  -- an aggregate, so array_agg has to sit OUTSIDE the locking select.
  SELECT array_agg(locked.id) INTO v_locked
  FROM (
    SELECT s.id
      FROM seats s
      JOIN venue_maps vm ON vm.id = s.venue_map_id
     WHERE s.id = ANY(p_seat_ids)
       AND vm.event_id = p_event_id
       AND s.status = 'available'
     ORDER BY s.id
     FOR UPDATE OF s SKIP LOCKED
  ) AS locked;

  v_locked_n := COALESCE(array_length(v_locked, 1), 0);

  -- All or nothing. Partially filling an order leaves the buyer paying for a
  -- group that can no longer sit together.
  IF v_locked_n <> v_requested THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
      'message', 'One or more of those seats has just been taken. Refresh the map and try again.',
      'requested', v_requested, 'available', v_locked_n);
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  UPDATE seats
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = ANY(v_locked);

  INSERT INTO reservation_items (reservation_id, seat_id, tier_id, unit_price_cents)
  SELECT v_res_id, s.id, s.tier_id, seat_price_cents(s.id)
    FROM seats s WHERE s.id = ANY(v_locked);

  SELECT COALESCE(SUM(unit_price_cents), 0) INTO v_total
    FROM reservation_items WHERE reservation_id = v_res_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'expires_at', v_expires,
    'seat_count', v_locked_n,
    'subtotal_cents', v_total,
    'currency', v_event.currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═══════════════════════════════════════════════════════════════════════════
-- hold_table — reserve a whole table and every seat on it
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION hold_table(
  p_event_id    UUID,
  p_user_id     UUID,
  p_table_id    UUID,
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_event   RECORD;
  v_table   RECORD;
  v_seats   UUID[];
  v_free    INT;
  v_total   INT;
  v_res_id  UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT id, status, purchase_mode, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  IF v_event.purchase_mode = 'seat_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event sells individual seats only.');
  END IF;

  -- Plain FOR UPDATE, not SKIP LOCKED: a second buyer for the same table should
  -- WAIT and then see the real outcome, not be told it is busy and retry into
  -- the same race.
  SELECT t.id, t.status, t.price_cents, t.seat_count, t.label, t.is_private
    INTO v_table
    FROM tables t
    JOIN venue_maps vm ON vm.id = t.venue_map_id
   WHERE t.id = p_table_id AND vm.event_id = p_event_id
     FOR UPDATE OF t;

  IF v_table IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That table is not part of this event.');
  END IF;

  -- BRD §25 — once ONE seat has gone individually, the whole-table option is
  -- closed for good. `partial` is exactly that state, maintained by
  -- trg_sync_table_status from the seats themselves rather than set by hand.
  IF v_table.status = 'partial' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_PARTIALLY_SOLD',
      'message', 'Seats at this table have already been sold individually, so it can no longer be booked whole.');
  END IF;

  IF v_table.status <> 'available' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_UNAVAILABLE',
      'message', 'That table is no longer available.');
  END IF;

  -- A table with no price cannot be sold whole. Refused here rather than
  -- charging zero, which is the failure nobody notices until the payout.
  IF v_table.price_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This table has no price set and cannot be booked whole.');
  END IF;

  SELECT array_agg(s.id ORDER BY s.id),
         count(*),
         count(*) FILTER (WHERE s.status = 'available')
    INTO v_seats, v_total, v_free
    FROM seats s WHERE s.table_id = p_table_id;

  IF COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_UNAVAILABLE',
      'message', 'That table has no seats.');
  END IF;

  -- Belt and braces against the status column: it is derived by a trigger, and
  -- deriving it is what makes it trustworthy — but the seats are the ground
  -- truth and the buyer is about to be charged for all of them.
  IF v_free <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_PARTIALLY_SOLD',
      'message', 'Some seats at this table are no longer free.');
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  -- Every seat moves with the table, so nothing on it can be sold separately.
  UPDATE seats
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = ANY(v_seats);

  UPDATE tables
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = p_table_id;

  -- ONE item at the table's own price — not one per seat. The table price is
  -- independent of the seats (BRD §25); charging the sum would ignore whatever
  -- discount or premium the organizer set.
  INSERT INTO reservation_items (reservation_id, table_id, unit_price_cents)
  VALUES (v_res_id, p_table_id, v_table.price_cents);

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'expires_at', v_expires,
    'table_label', v_table.label,
    'seat_count', v_total,
    'subtotal_cents', v_table.price_cents,
    'currency', v_event.currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═══════════════════════════════════════════════════════════════════════════
-- release_reservation — put the stock back
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION release_reservation(p_reservation_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_state reservation_state;
  v_seats INT;
BEGIN
  SELECT state INTO v_state FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND');
  END IF;

  -- Converted means it was paid for. Releasing it would put sold stock back on
  -- sale, so it is refused rather than treated as a no-op.
  IF v_state = 'converted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'That reservation has already been paid for.');
  END IF;

  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE held_by_reservation = p_reservation_id;
  GET DIAGNOSTICS v_seats = ROW_COUNT;

  -- The seat update fires trg_sync_table_status, which recomputes the table.
  -- This clears the hold marker the trigger does not touch.
  UPDATE tables SET held_by_reservation = NULL
   WHERE held_by_reservation = p_reservation_id;

  UPDATE reservations SET state = 'released' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'seats_released', v_seats);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═══════════════════════════════════════════════════════════════════════════
-- expire_stale_reservations — the sweeper
-- ═══════════════════════════════════════════════════════════════════════════
-- Without this, an abandoned checkout holds its seats until the heat death of
-- the event. Run on a schedule; safe to run concurrently with itself because
-- each row is claimed by the UPDATE that marks it expired.
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INT AS $$
DECLARE
  v_ids UUID[];
BEGIN
  UPDATE reservations
     SET state = 'expired'
   WHERE state = 'active' AND expires_at < now()
  RETURNING id INTO v_ids;

  SELECT array_agg(id) INTO v_ids
    FROM reservations
   WHERE state = 'expired' AND expires_at < now()
     AND EXISTS (SELECT 1 FROM seats WHERE held_by_reservation = reservations.id);

  IF v_ids IS NULL THEN RETURN 0; END IF;

  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);
  UPDATE tables SET held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);

  RETURN COALESCE(array_length(v_ids, 1), 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION hold_seats IS
  'Atomically holds individual seats. Locks parent tables first, in id order, so a whole-table buyer and a single-seat buyer cannot both succeed.';
COMMENT ON FUNCTION hold_table IS
  'Atomically holds a whole table and all its seats at the table''s own price. Refuses once any seat has gone individually (BRD §25).';
