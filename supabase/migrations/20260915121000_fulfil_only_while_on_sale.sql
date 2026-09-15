-- ═══════════════════════════════════════════════════════════════════════════
-- A payment only turns into tickets while the event is still on sale.
--
-- BRD §17 / §09. A buyer can be on Stripe's page when an admin cancels or
-- suspends the event. `fulfill_checkout` never looked at the event's status:
-- the only thing standing in the way was the re-quote in Node, which refused by
-- THROWING out of the webhook handler — so the payment was recorded as "handler
-- threw" rather than as the specific, reviewable thing it is, and any caller
-- that reached the function without that quote would have sold the seat and
-- issued tickets for an event that is not going to happen.
--
-- Now the function refuses on its own, with a code that says why. A reservation
-- that was already converted still returns its order: a retried webhook for a
-- sale that completed before the cancellation is not a new sale.
--
-- Cancelling or suspending also expires the event's open Checkout Sessions and
-- releases their holds (services/openCheckouts.js), so most of these payments
-- are never taken at all. This is the backstop for the ones that slip through.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_reservation_id UUID, p_channel payment_channel,
  p_breakdown JSONB, p_buyer JSONB, p_stripe JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res RECORD; v_event RECORD; v_order_id UUID; v_existing UUID;
  v_currency CHAR(3); v_seat_ids UUID[]; v_table_ids UUID[];
  v_tickets INT := 0; v_key TEXT;
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
  ) RETURNING id INTO v_order_id;

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
