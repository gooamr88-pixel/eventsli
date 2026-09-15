-- ═══════════════════════════════════════════════════════════════════════════
-- Ticket-type allocations are enforced, and a listing-only event sells nothing.
--
-- ALLOCATIONS. `ticket_tiers.quantity` existed, the organizer could set it, and
-- nothing read it — `sold_count` was never written by anything. A 50-ticket VIP
-- type mapped to 200 seats sold 200; the tier list said "0 sold"; the guards
-- that refuse cutting an allocation below what has sold, or deleting a type
-- that has sold, could never fire.
--
--   • `sold_count` is now kept by a trigger on `tickets`, recounted from paid,
--     non-void tickets. A trigger rather than a line in each sale function, so
--     every path that issues or removes a ticket keeps it true.
--   • `tier_allocation_exceeded` is checked while seats are held, while a table
--     is held and while a door sale is recorded, under a row lock on the tier.
--     It counts what has sold AND what is currently held, so ten buyers at the
--     checkout cannot all take the last allocation. A hold past its expiry that
--     the sweeper has not reached yet still counts, for at most a minute.
--
-- LISTING-ONLY (BRD §12). No hold or sale function read `listing_type`, so a
-- `display_only` event that had a seat map accepted holds, checkout and door
-- sales. The three functions that create a sale now refuse it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── sold_count follows the tickets ────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_tier_sold_count() RETURNS TRIGGER AS $$
DECLARE
  v_tiers UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tiers := ARRAY[NEW.tier_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_tiers := ARRAY[OLD.tier_id];
  ELSE
    v_tiers := ARRAY[OLD.tier_id, NEW.tier_id];
  END IF;

  UPDATE ticket_tiers tt
     SET sold_count = (
       SELECT count(*)
         FROM tickets t
         JOIN orders o ON o.id = t.order_id
        WHERE t.tier_id = tt.id AND o.status = 'paid' AND t.status <> 'void'
     )
   WHERE tt.id = ANY(v_tiers);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION sync_tier_sold_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_tier_sold_count ON tickets;
CREATE TRIGGER trg_sync_tier_sold_count
  AFTER INSERT OR DELETE OR UPDATE OF tier_id, status ON tickets
  FOR EACH ROW EXECUTE FUNCTION sync_tier_sold_count();

DO $$
DECLARE v_wrong INT;
BEGIN
  SELECT count(*) INTO v_wrong
    FROM ticket_tiers tt
   WHERE tt.sold_count IS DISTINCT FROM (
     SELECT count(*) FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.tier_id = tt.id AND o.status = 'paid' AND t.status <> 'void'
   );
  RAISE NOTICE 'sold_count backfill: % ticket types to correct', v_wrong;
END $$;

UPDATE ticket_tiers tt
   SET sold_count = c.n
  FROM (
    SELECT t2.id, (
      SELECT count(*) FROM tickets t JOIN orders o ON o.id = t.order_id
       WHERE t.tier_id = t2.id AND o.status = 'paid' AND t.status <> 'void'
    ) AS n
      FROM ticket_tiers t2
  ) c
 WHERE c.id = tt.id AND tt.sold_count IS DISTINCT FROM c.n;

-- ─── The allocation check, shared by every path that takes stock ──────────
-- Locks the tiers involved (id order) and returns the name of the first one the
-- given seats would push past its quantity, or NULL. Seats being requested are
-- assumed available; they are excluded from the "held" count so a caller never
-- counts its own selection twice.
CREATE OR REPLACE FUNCTION tier_allocation_exceeded(p_seat_ids UUID[])
RETURNS TEXT AS $$
DECLARE
  v_name TEXT;
BEGIN
  PERFORM 1
     FROM ticket_tiers
    WHERE quantity IS NOT NULL
      AND id IN (SELECT DISTINCT s.tier_id FROM seats s
                  WHERE s.id = ANY(p_seat_ids) AND s.tier_id IS NOT NULL)
    ORDER BY id
      FOR UPDATE;

  SELECT tt.name INTO v_name
    FROM ticket_tiers tt
   WHERE tt.quantity IS NOT NULL
     AND tt.id IN (SELECT s.tier_id FROM seats s WHERE s.id = ANY(p_seat_ids))
     AND tt.sold_count
       + (SELECT count(*) FROM seats h
           WHERE h.tier_id = tt.id AND h.status = 'held' AND NOT (h.id = ANY(p_seat_ids)))
       + (SELECT count(*) FROM seats r WHERE r.tier_id = tt.id AND r.id = ANY(p_seat_ids))
       > tt.quantity
   ORDER BY tt.name
   LIMIT 1;

  RETURN v_name;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION tier_allocation_exceeded(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_allocation_exceeded(UUID[]) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- hold_seats
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
  v_full_tier   TEXT;
BEGIN
  v_requested := COALESCE(array_length(p_seat_ids, 1), 0);
  IF v_requested = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Select at least one seat.');
  END IF;

  SELECT id, status, listing_type, purchase_mode, max_tickets_per_order, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  -- BRD §12 — a listing with nothing behind it.
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold here.');
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
  SELECT array_agg(DISTINCT s.table_id ORDER BY s.table_id)
    INTO v_table_ids
    FROM seats s
   WHERE s.id = ANY(p_seat_ids) AND s.table_id IS NOT NULL;

  IF v_table_ids IS NOT NULL THEN
    PERFORM 1 FROM tables WHERE id = ANY(v_table_ids) ORDER BY id FOR UPDATE;
  END IF;

  -- ── Lock the seats themselves. ──
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

  -- ── Ticket-type allocations, counting what is sold and what is held. ──
  v_full_tier := tier_allocation_exceeded(v_locked);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out.', v_full_tier));
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
-- hold_table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION hold_table(
  p_event_id    UUID,
  p_user_id     UUID,
  p_table_id    UUID,
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_event     RECORD;
  v_table     RECORD;
  v_seats     UUID[];
  v_free      INT;
  v_total     INT;
  v_res_id    UUID;
  v_expires   TIMESTAMPTZ;
  v_full_tier TEXT;
BEGIN
  SELECT id, status, listing_type, purchase_mode, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  -- BRD §12 — a listing with nothing behind it.
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold here.');
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
  -- closed for good.
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

  IF v_free <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_PARTIALLY_SOLD',
      'message', 'Some seats at this table are no longer free.');
  END IF;

  -- ── Ticket-type allocations of the seats that come with the table. ──
  v_full_tier := tier_allocation_exceeded(v_seats);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out, so this table cannot be booked whole.', v_full_tier));
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  UPDATE seats
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = ANY(v_seats);

  UPDATE tables
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = p_table_id;

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
-- record_manual_sale — as 20260915120000, plus listing-only and allocations
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION record_manual_sale(
  p_event_id   UUID,
  p_seat_ids   UUID[],
  p_table_id   UUID,
  p_breakdown  JSONB,
  p_buyer      JSONB,
  p_method     TEXT,
  p_note       TEXT,
  p_recorded_by UUID
) RETURNS JSONB AS $$
DECLARE
  v_event     RECORD;
  v_order_id  UUID;
  v_seats     UUID[] := COALESCE(p_seat_ids, ARRAY[]::UUID[]);
  v_locked    UUID[];
  v_tickets   INT := 0;
  v_count     INT;
  v_key       TEXT;
  v_full_tier TEXT;
BEGIN
  SELECT id, organizer_id, currency, status, listing_type INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is not on sale.');
  END IF;
  -- BRD §12 — a listing with nothing behind it takes no door sales either.
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold for it.');
  END IF;

  IF p_table_id IS NOT NULL THEN
    PERFORM 1
       FROM tables t
       JOIN venue_maps vm ON vm.id = t.venue_map_id
      WHERE t.id = p_table_id AND vm.event_id = p_event_id
        FOR UPDATE OF t;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
        'message', 'That table is not part of this event.');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_seats
      FROM seats WHERE table_id = p_table_id;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::UUID[]) INTO v_seats
      FROM unnest(v_seats) AS x;
  END IF;

  IF COALESCE(array_length(v_seats, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose the seats or the table that were sold.');
  END IF;

  SELECT count(*) INTO v_count
    FROM seats s
    JOIN venue_maps vm ON vm.id = s.venue_map_id
   WHERE s.id = ANY(v_seats) AND vm.event_id = p_event_id;

  IF v_count <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'Some of those seats are not part of this event.');
  END IF;

  SELECT array_agg(locked.id) INTO v_locked
  FROM (
    SELECT s.id FROM seats s
     WHERE s.id = ANY(v_seats) AND s.status = 'available'
     ORDER BY s.id FOR UPDATE OF s SKIP LOCKED
  ) AS locked;

  IF COALESCE(array_length(v_locked, 1), 0) <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
      'message', 'Some of those seats are already sold or held.');
  END IF;

  -- A door sale takes from the same allocation as the website.
  v_full_tier := tier_allocation_exceeded(v_seats);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out.', v_full_tier));
  END IF;

  INSERT INTO orders (
    event_id, organizer_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    guest_name, guest_email, guest_phone,
    manual_method, manual_note, recorded_by, paid_at
  ) VALUES (
    p_event_id, v_event.organizer_id, NULL, 'manual', 'paid', v_event.currency,
    array_length(v_seats, 1),
    (p_breakdown->>'subtotalCents')::BIGINT,
    COALESCE((p_breakdown->>'eventTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0),
    0,
    'organizer',
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    p_method, p_note, p_recorded_by, now()
  ) RETURNING id INTO v_order_id;

  UPDATE seats SET status = 'sold' WHERE id = ANY(v_seats);
  IF p_table_id IS NOT NULL THEN
    UPDATE tables SET status = 'sold' WHERE id = p_table_id;
  END IF;

  INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
  SELECT v_order_id, s.tier_id, s.id, s.table_id,
         s.section_key || ' ' || s.row_label || s.seat_number,
         seat_price_cents(s.id)
    FROM seats s WHERE s.id = ANY(v_seats);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id)
  SELECT v_order_id, p_event_id, s.id, s.table_id, s.tier_id
    FROM seats s WHERE s.id = ANY(v_seats);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  v_key := v_order_id::TEXT;
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission', 'credit', (p_breakdown->>'commissionCents')::BIGINT,
      v_event.currency, 'm_commission_' || v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission_tax', 'credit', (p_breakdown->>'commissionTaxCents')::BIGINT,
      v_event.currency, 'm_commission_tax_' || v_key);
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets,
    'commission_owed_cents', manual_commission_owed(p_event_id, v_event.currency));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
