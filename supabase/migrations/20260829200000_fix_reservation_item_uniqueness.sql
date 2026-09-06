-- ═══════════════════════════════════════════════════════════════════════════
-- A seat could only ever be reserved ONCE — in the lifetime of the event.
--
-- reservation_items_seat_uniq and _table_uniq are unique over the whole table.
-- The invariant they were meant to express is "a seat is in at most one LIVE
-- hold"; what they actually expressed is "a seat appears in at most one row,
-- ever". So the first abandoned checkout permanently removed that seat from
-- sale: the hold released, the seat went back to `available`, and the next
-- buyer hit
--
--   duplicate key value violates unique constraint "reservation_items_table_uniq"
--
-- from a row belonging to a reservation that no longer exists in any meaningful
-- sense. Nothing in the seat's own state showed the problem, which is why it
-- took a release-then-rebook test to find it.
--
-- The fix is to make the dead rows actually die. A released or expired hold has
-- no reason to keep its items: `orders` and `order_items` are the permanent
-- record of what was bought, while `reservations` are ephemeral. Items are
-- therefore deleted on release and on expiry — but NOT on conversion, where
-- they are the basis of the order and where the unique index correctly keeps a
-- sold seat from being reserved again.
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

  -- Converted means paid for. Releasing it would put sold stock back on sale.
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

  -- Without this, the seat is free but permanently unreservable.
  DELETE FROM reservation_items WHERE reservation_id = p_reservation_id;

  UPDATE reservations SET state = 'released' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'seats_released', v_seats);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── The sweeper, rewritten ────────────────────────────────────────────────
-- The previous version also had a real bug: `UPDATE ... RETURNING id INTO v_ids`
-- assigns a SCALAR, so with several expired reservations it raised
-- "query returned more than one row" and swept nothing. Collect the ids first,
-- then act on them.
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INT AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM reservations
   WHERE state = 'active' AND expires_at < now();

  IF v_ids IS NULL THEN RETURN 0; END IF;

  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);

  UPDATE tables SET held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);

  DELETE FROM reservation_items WHERE reservation_id = ANY(v_ids);

  -- Marked last: if anything above fails the transaction rolls back and the
  -- reservation stays 'active', so the next sweep retries it. Marking first
  -- would leave stock held by a reservation nothing will ever revisit.
  UPDATE reservations SET state = 'expired' WHERE id = ANY(v_ids);

  RETURN array_length(v_ids, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON INDEX reservation_items_seat_uniq IS
  'A seat is in at most one live hold. Rows are deleted on release/expiry, so this constrains live holds and sold seats only.';
COMMENT ON INDEX reservation_items_table_uniq IS
  'As above, for whole-table holds.';
