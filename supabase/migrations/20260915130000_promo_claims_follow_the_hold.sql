-- ═══════════════════════════════════════════════════════════════════════════
-- A discount-code use lives and dies with the hold that claimed it.
--
-- Three things were wrong, and together they meant a limited code wore out on
-- checkouts nobody paid for, while a code somebody DID pay with could be freed
-- for reuse:
--
--   1. The sweeper and release_reservation were written before codes existed,
--      and never removed a hold's claim. claim_promo_code counted every row, so
--      fifty abandoned checkouts exhausted a fifty-use code.
--   2. fulfill_checkout never recorded the order on the claim (or the code on
--      the order), so release_promo_claim's `order_id IS NULL` guard was always
--      true — a paid order's claim was releasable.
--   3. release_promo_claim did not check that the hold was still open.
--
-- Also here, because it is the same function: the sweeper selected expired ids,
-- then updated them WITHOUT re-checking `state = 'active'`. A checkout that was
-- fulfilled in between was flipped to `expired` and its items deleted. It now
-- claims rows in ONE statement, which Postgres re-evaluates under the row lock.
--
-- The backfill links existing paid claims to their orders and removes claims
-- whose hold ended without a sale. Those rows are not a record of anything
-- bought — they are uses the code never got back. Counts are printed first.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_dead_claims      INT;
  v_unlinked_claims  INT;
  v_orders_no_code   INT;
BEGIN
  SELECT count(*) INTO v_dead_claims
    FROM promo_redemptions pr JOIN reservations r ON r.id = pr.reservation_id
   WHERE r.state IN ('expired', 'released') AND pr.order_id IS NULL;

  SELECT count(*) INTO v_unlinked_claims
    FROM promo_redemptions pr JOIN orders o ON o.reservation_id = pr.reservation_id
   WHERE pr.order_id IS NULL;

  SELECT count(*) INTO v_orders_no_code
    FROM orders o JOIN promo_redemptions pr ON pr.reservation_id = o.reservation_id
   WHERE o.promo_id IS NULL;

  RAISE NOTICE 'promo backfill: claims from holds that ended unpaid = %, paid claims not linked to their order = %, paid orders missing their code = %',
    v_dead_claims, v_unlinked_claims, v_orders_no_code;
END $$;

-- ─── release_reservation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_reservation(p_reservation_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_state reservation_state;
  v_seats INT;
  v_promo UUID;
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

  -- A released hold gives back the discount-code use it claimed.
  DELETE FROM promo_redemptions
   WHERE reservation_id = p_reservation_id AND order_id IS NULL
  RETURNING promo_id INTO v_promo;

  IF v_promo IS NOT NULL THEN
    UPDATE promo_codes
       SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo)
     WHERE id = v_promo;
  END IF;

  UPDATE reservations SET state = 'released', promo_id = NULL WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'seats_released', v_seats);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── expire_stale_reservations — the sweeper ───────────────────────────────
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INT AS $$
DECLARE
  v_ids    UUID[];
  v_promos UUID[];
BEGIN
  -- Claimed and marked in ONE statement. A plain SELECT of ids followed by an
  -- UPDATE let fulfill_checkout convert a hold in between, and the UPDATE then
  -- marked a paid reservation expired. An UPDATE re-checks its WHERE after
  -- waiting on the row lock fulfilment holds, so a converted hold is skipped.
  -- Everything below is in the same transaction, so a failure still rolls the
  -- marking back and the next sweep retries.
  WITH claimed AS (
    UPDATE reservations
       SET state = 'expired'
     WHERE state = 'active' AND expires_at < now()
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM claimed;

  IF v_ids IS NULL THEN RETURN 0; END IF;

  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);

  UPDATE tables SET held_by_reservation = NULL
   WHERE held_by_reservation = ANY(v_ids);

  DELETE FROM reservation_items WHERE reservation_id = ANY(v_ids);

  -- An abandoned checkout gives back the code use it claimed.
  WITH freed AS (
    DELETE FROM promo_redemptions
     WHERE reservation_id = ANY(v_ids) AND order_id IS NULL
    RETURNING promo_id
  )
  SELECT array_agg(DISTINCT promo_id) INTO v_promos FROM freed;

  IF v_promos IS NOT NULL THEN
    UPDATE promo_codes pc
       SET used_count = (SELECT count(*) FROM promo_redemptions pr WHERE pr.promo_id = pc.id)
     WHERE pc.id = ANY(v_promos);
  END IF;

  UPDATE reservations SET promo_id = NULL
   WHERE id = ANY(v_ids) AND promo_id IS NOT NULL;

  RETURN array_length(v_ids, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── claim_promo_code ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_promo_code(
  p_code           TEXT,
  p_event_id       UUID,
  p_reservation_id UUID,
  p_subtotal_cents BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_promo    RECORD;
  v_used     INT;
  v_discount BIGINT;
BEGIN
  SELECT * INTO v_promo FROM promo_codes
   WHERE upper(code) = upper(btrim(p_code))
     AND (event_id = p_event_id OR event_id IS NULL)
   FOR UPDATE;

  IF v_promo IS NULL OR NOT v_promo.is_active THEN
    -- One answer for "no such code" and "disabled": telling them apart lets
    -- someone map which codes exist by trying strings.
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;

  IF v_promo.valid_from IS NOT NULL AND v_promo.valid_from > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;
  IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code has expired.');
  END IF;

  IF v_promo.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM promo_redemptions pr
      LEFT JOIN reservations r ON r.id = pr.reservation_id
     WHERE pr.promo_id = v_promo.id
       -- This hold's own claim is not competition for itself. Counting it means
       -- a refresh of the checkout page reports the buyer's own code exhausted.
       AND pr.reservation_id IS DISTINCT FROM p_reservation_id
       -- Only claims that still stand: a paid order, or a hold that is open and
       -- not yet past its expiry. A lapsed hold the sweeper has not reached yet
       -- is not somebody using the code.
       AND (pr.order_id IS NOT NULL
            OR r.state = 'converted'
            OR (r.state = 'active' AND r.expires_at > now()));

    IF v_used >= v_promo.max_uses THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
        'message', 'That code has been fully used.');
    END IF;
  END IF;

  IF v_promo.discount_type = 'percentage' THEN
    v_discount := round(p_subtotal_cents * v_promo.discount_value / 100.0);
  ELSE
    v_discount := round(v_promo.discount_value * 100);
  END IF;

  -- Never more than the order: a negative total is a refund nobody authorised.
  v_discount := LEAST(GREATEST(v_discount, 0), p_subtotal_cents);

  INSERT INTO promo_redemptions (promo_id, reservation_id, amount_cents)
  VALUES (v_promo.id, p_reservation_id, v_discount)
  ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
  DO UPDATE SET promo_id = EXCLUDED.promo_id, amount_cents = EXCLUDED.amount_cents;

  UPDATE reservations SET promo_id = v_promo.id WHERE id = p_reservation_id;

  UPDATE promo_codes
     SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo.id)
   WHERE id = v_promo.id;

  RETURN jsonb_build_object('ok', true, 'promo_id', v_promo.id,
    'code', v_promo.code, 'discount_cents', v_discount,
    'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── release_promo_claim ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_promo_claim(p_reservation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_promo UUID;
BEGIN
  -- Only while the hold is still open. A paid order's claim is part of what was
  -- bought; releasing it would let a single-use code be used again.
  DELETE FROM promo_redemptions pr
   WHERE pr.reservation_id = p_reservation_id
     AND pr.order_id IS NULL
     AND EXISTS (
       SELECT 1 FROM reservations r WHERE r.id = p_reservation_id AND r.state = 'active'
     )
  RETURNING pr.promo_id INTO v_promo;

  IF v_promo IS NOT NULL THEN
    UPDATE promo_codes
       SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo)
     WHERE id = v_promo;
    UPDATE reservations SET promo_id = NULL WHERE id = p_reservation_id;
  END IF;

  RETURN v_promo IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── fulfill_checkout — now records the code on the order and the order on the claim
CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_reservation_id UUID, p_channel payment_channel,
  p_breakdown JSONB, p_buyer JSONB, p_stripe JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res RECORD; v_event RECORD; v_order_id UUID; v_existing UUID;
  v_currency CHAR(3); v_seat_ids UUID[]; v_table_ids UUID[];
  v_tickets INT := 0; v_key TEXT;
  v_promo_id UUID; v_promo_code TEXT;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND',
      'message', 'That reservation no longer exists.');
  END IF;

  IF v_res.state = 'converted' THEN
    SELECT id INTO v_existing FROM orders WHERE reservation_id = p_reservation_id LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'already_fulfilled', true, 'order_id', v_existing);
  END IF;

  IF v_res.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED',
      'message', 'That hold had already been released when the payment arrived.',
      'state', v_res.state);
  END IF;

  SELECT id, organizer_id, currency, fee_bearer, payment_fee_mode, status
    INTO v_event FROM events WHERE id = v_res.event_id;

  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false,
      'error', CASE v_event.status
                 WHEN 'cancelled' THEN 'EVENT_CANCELLED'
                 WHEN 'suspended' THEN 'EVENT_SUSPENDED'
                 ELSE 'EVENT_NOT_PUBLISHED'
               END,
      'message', 'This event is no longer on sale, so the payment did not issue tickets. It needs review.',
      'event_status', v_event.status);
  END IF;

  v_currency := v_event.currency;

  -- The code this hold claimed, if any — recorded on the order so a receipt
  -- can say which code it was bought with.
  SELECT pr.promo_id, pc.code INTO v_promo_id, v_promo_code
    FROM promo_redemptions pr
    JOIN promo_codes pc ON pc.id = pr.promo_id
   WHERE pr.reservation_id = p_reservation_id;

  INSERT INTO orders (
    event_id, organizer_id, user_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, discount_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    payment_fee_mode, stripe_cost_cents, platform_net_cents,
    guest_name, guest_email, guest_phone,
    stripe_session_id, stripe_payment_intent_id, paid_at,
    promo_id, promo_code
  ) VALUES (
    v_res.event_id, v_event.organizer_id,
    NULLIF(p_buyer->>'user_id', '')::UUID,
    p_reservation_id, p_channel, 'paid', v_currency,
    (p_breakdown->>'quantity')::INT,
    (p_breakdown->>'subtotalCents')::BIGINT,
    COALESCE((p_breakdown->>'discountCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'eventTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT, 0),
    (p_breakdown->>'feeBearer')::fee_bearer,
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    (p_breakdown->>'organizerNetCents')::BIGINT,
    v_event.payment_fee_mode,
    COALESCE((p_breakdown->>'stripeCostCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'platformNetCents')::BIGINT, 0),
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    NULLIF(p_stripe->>'session_id', ''), NULLIF(p_stripe->>'payment_intent_id', ''),
    now(),
    v_promo_id, v_promo_code
  ) RETURNING id INTO v_order_id;

  -- The claim now belongs to a sale, so nothing can release it.
  IF v_promo_id IS NOT NULL THEN
    UPDATE promo_redemptions SET order_id = v_order_id WHERE reservation_id = p_reservation_id;
  END IF;

  -- Copied BEFORE the reservation items are touched by anything else.
  PERFORM copy_reservation_items_to_order(p_reservation_id, v_order_id);

  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL),
         array_agg(table_id) FILTER (WHERE table_id IS NOT NULL)
    INTO v_seat_ids, v_table_ids
    FROM reservation_items WHERE reservation_id = p_reservation_id;

  IF v_table_ids IS NOT NULL THEN
    SELECT COALESCE(v_seat_ids, ARRAY[]::UUID[]) || COALESCE(array_agg(s.id), ARRAY[]::UUID[])
      INTO v_seat_ids FROM seats s WHERE s.table_id = ANY(v_table_ids);
    UPDATE tables SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_table_ids);
  END IF;

  UPDATE seats SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_seat_ids);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, s.id, s.table_id, s.tier_id, NULL
    FROM seats s WHERE s.id = ANY(v_seat_ids);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  v_key := v_order_id::TEXT;
  PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
    'sale', 'credit', (p_breakdown->>'buyerTotalCents')::BIGINT, v_currency, 'sale_' || v_key);
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission','debit',(p_breakdown->>'commissionCents')::BIGINT,v_currency,'commission_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission_tax','debit',(p_breakdown->>'commissionTaxCents')::BIGINT,v_currency,'commission_tax_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'payment_fee','debit',(p_breakdown->>'paymentFeeCents')::BIGINT,v_currency,'payment_fee_'||v_key);
  END IF;
  IF p_channel = 'stripe' THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'transfer','debit',(p_breakdown->>'organizerNetCents')::BIGINT,v_currency,'transfer_'||v_key);
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets, 'currency', v_currency);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Backfill ──────────────────────────────────────────────────────────────
UPDATE promo_redemptions pr
   SET order_id = o.id
  FROM orders o
 WHERE pr.order_id IS NULL
   AND pr.reservation_id IS NOT NULL
   AND o.reservation_id = pr.reservation_id;

UPDATE orders o
   SET promo_id = pr.promo_id, promo_code = pc.code
  FROM promo_redemptions pr
  JOIN promo_codes pc ON pc.id = pr.promo_id
 WHERE pr.order_id = o.id AND o.promo_id IS NULL;

DELETE FROM promo_redemptions pr
 USING reservations r
 WHERE r.id = pr.reservation_id
   AND r.state IN ('expired', 'released')
   AND pr.order_id IS NULL;

UPDATE reservations SET promo_id = NULL
 WHERE state IN ('expired', 'released') AND promo_id IS NOT NULL;

UPDATE promo_codes pc
   SET used_count = c.n
  FROM (
    SELECT p.id, (SELECT count(*) FROM promo_redemptions pr WHERE pr.promo_id = p.id) AS n
      FROM promo_codes p
  ) c
 WHERE c.id = pc.id AND pc.used_count IS DISTINCT FROM c.n;
