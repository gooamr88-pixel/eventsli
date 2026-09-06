-- ═══════════════════════════════════════════════════════════════════════════
-- Turning a paid hold into an order, tickets, and ledger entries.
--
-- One function, one transaction. Six things have to happen together:
--
--   reservation → converted        stock → sold
--   order created                  order_items copied from the hold
--   one ticket per seat            ledger entries written
--
-- Any subset of those is a broken state that someone has to repair by hand:
-- an order with no tickets is a buyer who paid and got nothing; tickets with
-- no ledger entries are revenue that does not exist in any report; seats left
-- `held` are stock that silently returns to sale when the sweeper runs, and is
-- then sold twice.
--
-- IDEMPOTENT BY THE RESERVATION. Stripe retries webhooks, and the browser
-- redirect can arrive before the webhook does — so this runs more than once for
-- the same payment as a matter of course, not as an edge case. The second call
-- returns the first call's order instead of creating another.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_reservation_id  UUID,
  p_channel         payment_channel,
  p_breakdown       JSONB,     -- computed by utils/money.js, snapshotted here
  p_buyer           JSONB,     -- { user_id, name, email, phone }
  p_stripe          JSONB      -- { session_id, payment_intent_id }
) RETURNS JSONB AS $$
DECLARE
  v_res       RECORD;
  v_event     RECORD;
  v_order_id  UUID;
  v_existing  UUID;
  v_currency  CHAR(3);
  v_seat_ids  UUID[];
  v_table_ids UUID[];
  v_tickets   INT := 0;
  v_key       TEXT;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND',
      'message', 'That reservation no longer exists.');
  END IF;

  -- ── Idempotency ──
  -- Checked BEFORE the expiry check on purpose: a payment that completed is
  -- fulfilled, and a webhook arriving after the hold's clock ran out must
  -- return the order rather than refuse it.
  IF v_res.state = 'converted' THEN
    SELECT id INTO v_existing FROM orders WHERE reservation_id = p_reservation_id LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'already_fulfilled', true, 'order_id', v_existing);
  END IF;

  IF v_res.state <> 'active' THEN
    -- Released or expired, and the money arrived anyway. Refunding is a human
    -- decision, so this reports rather than guesses.
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED',
      'message', 'That hold had already been released when the payment arrived.',
      'state', v_res.state);
  END IF;

  SELECT id, organizer_id, currency, fee_bearer, payment_fee_mode
    INTO v_event FROM events WHERE id = v_res.event_id;
  v_currency := v_event.currency;

  -- ── The order ──
  INSERT INTO orders (
    event_id, organizer_id, user_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, discount_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    payment_fee_mode, stripe_cost_cents, platform_net_cents,
    guest_name, guest_email, guest_phone,
    stripe_session_id, stripe_payment_intent_id, paid_at
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
    now()
  )
  RETURNING id INTO v_order_id;

  -- ── The stock ──
  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL),
         array_agg(table_id) FILTER (WHERE table_id IS NOT NULL)
    INTO v_seat_ids, v_table_ids
    FROM reservation_items WHERE reservation_id = p_reservation_id;

  -- A whole-table item names no seats, so collect the table's own.
  IF v_table_ids IS NOT NULL THEN
    SELECT COALESCE(v_seat_ids, ARRAY[]::UUID[]) || COALESCE(array_agg(s.id), ARRAY[]::UUID[])
      INTO v_seat_ids
      FROM seats s WHERE s.table_id = ANY(v_table_ids);

    UPDATE tables SET status = 'sold', held_by_reservation = NULL
     WHERE id = ANY(v_table_ids);
  END IF;

  UPDATE seats SET status = 'sold', held_by_reservation = NULL
   WHERE id = ANY(v_seat_ids);

  -- ── The tickets ──
  -- One per SEAT, including for a whole-table purchase: six people arrive at a
  -- table of six and each needs something to scan.
  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, s.id, s.table_id, s.tier_id, NULL
    FROM seats s WHERE s.id = ANY(v_seat_ids);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  -- ── The order lines ──
  INSERT INTO order_items (order_id, tier_id, seat_id, unit_price_cents)
  SELECT v_order_id, ri.tier_id, ri.seat_id, ri.unit_price_cents
    FROM reservation_items ri WHERE ri.reservation_id = p_reservation_id;

  -- ── The ledger ──
  -- Keys are derived from the ORDER id, so a retry writes the same rows and the
  -- unique index turns the duplicate into a no-op rather than double-counting.
  v_key := v_order_id::TEXT;

  PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
    'sale', 'credit', (p_breakdown->>'buyerTotalCents')::BIGINT, v_currency,
    'sale_' || v_key);

  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission', 'debit', (p_breakdown->>'commissionCents')::BIGINT, v_currency,
      'commission_' || v_key);
  END IF;

  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission_tax', 'debit', (p_breakdown->>'commissionTaxCents')::BIGINT, v_currency,
      'commission_tax_' || v_key);
  END IF;

  IF COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'payment_fee', 'debit', (p_breakdown->>'paymentFeeCents')::BIGINT, v_currency,
      'payment_fee_' || v_key);
  END IF;

  -- BRD §08 — there is no escrow. On the card path Stripe moves the organizer's
  -- share at the moment of the charge, so the transfer is recorded NOW and the
  -- event's balance settles to zero. On the manual path the organizer already
  -- holds the cash, so no transfer is recorded and the balance stays positive:
  -- that remainder IS the commission they owe us (BRD §18).
  IF p_channel = 'stripe' THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'transfer', 'debit', (p_breakdown->>'organizerNetCents')::BIGINT, v_currency,
      'transfer_' || v_key);
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets, 'currency', v_currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── ledger_write ──────────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING on the idempotency key is what makes a retried
-- fulfilment safe: the second attempt writes nothing rather than doubling the
-- revenue.
CREATE OR REPLACE FUNCTION ledger_write(
  p_event_id UUID, p_organizer_id UUID, p_order_id UUID,
  p_channel payment_channel, p_type ledger_type, p_direction ledger_direction,
  p_amount_cents BIGINT, p_currency CHAR(3), p_idempotency_key TEXT
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN
    RAISE EXCEPTION 'ledger amount must be non-negative, got %', p_amount_cents;
  END IF;

  INSERT INTO ledger_entries (
    event_id, organizer_id, order_id, channel, entry_type, direction,
    amount_cents, currency, idempotency_key
  ) VALUES (
    p_event_id, p_organizer_id, p_order_id, p_channel, p_type, p_direction,
    p_amount_cents, p_currency, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION fulfill_checkout IS
  'Reservation to order, tickets, stock and ledger in one transaction. Idempotent by reservation: a retried webhook returns the original order.';
