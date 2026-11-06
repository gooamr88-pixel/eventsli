-- ─────────────────────────────────────────────────────────────────────────────
-- The organizer is the merchant of record (docs/TECH-AUDIT-LOG.md T-074).
--
-- Eventsli is event-management software. Ticket money must belong to the
-- organizer from the moment it is paid: it never sits in, or moves through, the
-- platform's balance. So card checkouts become Stripe DIRECT CHARGES on the
-- organizer's own connected account:
--
--   * the charge, the balance, Stripe's processing fee, refunds and disputes are
--     the organizer's;
--   * Eventsli receives only its `application_fee_amount` (commission + the tax
--     on that commission);
--   * the connected account is created with Stripe as the losses collector, so
--     an organizer's unrecoverable negative balance is not the platform's.
--
-- The old model was DESTINATION charges: the charge on the platform, the
-- platform paying Stripe's fee and every dispute, and a `transfer` of the
-- organizer's share. Orders already sold that way keep their history and their
-- ledger exactly as written; `charge_model` says which model an order used.
--
-- This migration:
--   1. orders: charge_model, stripe_account_id, stripe_charge_id, refund and
--      dispute state;
--   2. fulfill_checkout: a direct-charge branch — refuses a payment collected on
--      any account other than the event organizer's own, and writes no
--      `payment_fee` or `transfer` rows (neither exists in that model);
--   3. record_stripe_refund / record_application_fee_refund /
--      record_stripe_dispute: idempotent, append-only accounting of what
--      happens to a direct charge after it is paid.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS charge_model TEXT NOT NULL DEFAULT 'destination',
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS application_fee_refunded_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_status TEXT,
  ADD COLUMN IF NOT EXISTS disputed_cents BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_charge_model_known') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_charge_model_known
      CHECK (charge_model IN ('destination', 'direct'));
  END IF;
  -- A direct charge exists only on a connected account; without the account it
  -- could not be refunded, reconciled or isolated.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_direct_has_account') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_direct_has_account
      CHECK (charge_model <> 'direct' OR stripe_account_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_refund_within_total') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_refund_within_total
      CHECK (refunded_cents >= 0 AND refunded_cents <= buyer_total_cents);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fee_refund_within_fee') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_fee_refund_within_fee
      CHECK (application_fee_refunded_cents >= 0
             AND application_fee_refunded_cents <= commission_cents + commission_tax_cents);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_disputed_non_negative') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_disputed_non_negative CHECK (disputed_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_stripe_account_idx ON orders (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_stripe_charge_idx ON orders (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
-- The success page finds a paid-but-unfulfilled session's hold (and so the
-- organizer account it lives on) from OUR record of it, not from the URL.
CREATE INDEX IF NOT EXISTS reservations_stripe_session_idx
  ON reservations ((attendee_data->>'stripeSessionId'))
  WHERE attendee_data ? 'stripeSessionId';

-- ─── fulfill_checkout ──────────────────────────────────────────────────────
-- Identical to 20260917120000 except where marked DIRECT.
CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_reservation_id UUID, p_channel payment_channel,
  p_breakdown JSONB, p_buyer JSONB, p_stripe JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res RECORD; v_event RECORD; v_order_id UUID; v_existing UUID;
  v_currency CHAR(3); v_seat_ids UUID[]; v_table_ids UUID[];
  v_tickets INT := 0; v_general INT := 0; v_key TEXT;
  v_promo_id UUID; v_promo_code TEXT;
  v_direct BOOLEAN := (p_breakdown->>'chargeModel') = 'direct';
  v_account TEXT := NULLIF(p_stripe->>'account_id', '');
  v_org_account TEXT;
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

  -- DIRECT: the money was collected on a connected account. It must be THIS
  -- event's organizer's account — otherwise one organizer's charge could issue
  -- tickets for another organizer's event (organizer isolation).
  IF v_direct THEN
    SELECT stripe_account_id INTO v_org_account FROM organizers WHERE id = v_event.organizer_id;
    IF v_account IS NULL OR v_org_account IS NULL OR v_account <> v_org_account THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN',
        'message', 'That payment was not collected on this event organizer''s account.');
    END IF;
  END IF;

  v_currency := v_event.currency;

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
    promo_id, promo_code,
    charge_model, stripe_account_id                                    -- DIRECT
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
    v_promo_id, v_promo_code,
    CASE WHEN v_direct THEN 'direct' ELSE 'destination' END,
    CASE WHEN v_direct THEN v_account ELSE NULL END
  ) RETURNING id INTO v_order_id;

  IF v_promo_id IS NOT NULL THEN
    UPDATE promo_redemptions SET order_id = v_order_id WHERE reservation_id = p_reservation_id;
  END IF;

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

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, NULL, NULL, ri.tier_id, NULL
    FROM reservation_items ri
   CROSS JOIN generate_series(1, ri.quantity)
   WHERE ri.reservation_id = p_reservation_id
     AND ri.seat_id IS NULL
     AND ri.table_id IS NULL;
  GET DIAGNOSTICS v_general = ROW_COUNT;
  v_tickets := v_tickets + v_general;

  v_key := v_order_id::TEXT;
  -- The organizer's sale.
  PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
    'sale', 'credit', (p_breakdown->>'buyerTotalCents')::BIGINT, v_currency, 'sale_' || v_key);
  -- Eventsli's application fee: commission, and the tax on it.
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission','debit',(p_breakdown->>'commissionCents')::BIGINT,v_currency,'commission_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission_tax','debit',(p_breakdown->>'commissionTaxCents')::BIGINT,v_currency,'commission_tax_'||v_key);
  END IF;
  -- DIRECT: no `payment_fee` row (a buyer-paid service fee stays in the
  -- organizer's balance to offset the Stripe fee THEY pay) and no `transfer`
  -- row (nothing is transferred — the money was always theirs).
  IF NOT v_direct THEN
    IF COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT,0) > 0 THEN
      PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
        'payment_fee','debit',(p_breakdown->>'paymentFeeCents')::BIGINT,v_currency,'payment_fee_'||v_key);
    END IF;
    IF p_channel = 'stripe' THEN
      PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
        'transfer','debit',(p_breakdown->>'organizerNetCents')::BIGINT,v_currency,'transfer_'||v_key);
    END IF;
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets, 'currency', v_currency);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ─── record_stripe_refund ──────────────────────────────────────────────────
-- From `charge.refunded` on the organizer's account. `p_amount_refunded_cents`
-- is Stripe's CUMULATIVE `amount_refunded`, so a redelivered or out-of-order
-- event can only ever move the order forward to Stripe's figure, never past it,
-- and a duplicate writes nothing. A full refund voids the tickets not yet used.
CREATE OR REPLACE FUNCTION record_stripe_refund(
  p_payment_intent_id TEXT, p_account_id TEXT, p_charge_id TEXT, p_amount_refunded_cents BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_order orders%ROWTYPE; v_delta BIGINT; v_voided INT := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.charge_model = 'direct' AND v_order.stripe_account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_amount_refunded_cents IS NULL OR p_amount_refunded_cents < 0
     OR p_amount_refunded_cents > v_order.buyer_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR');
  END IF;

  UPDATE orders SET stripe_charge_id = COALESCE(stripe_charge_id, p_charge_id) WHERE id = v_order.id;

  v_delta := p_amount_refunded_cents - v_order.refunded_cents;
  IF v_delta <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_recorded', true, 'order_id', v_order.id,
      'refunded_cents', v_order.refunded_cents);
  END IF;

  PERFORM ledger_write(v_order.event_id, v_order.organizer_id, v_order.id, v_order.channel,
    'refund', 'debit', v_delta, v_order.currency,
    'refund_' || v_order.id || '_' || p_amount_refunded_cents);
  UPDATE orders SET refunded_cents = p_amount_refunded_cents WHERE id = v_order.id;

  IF p_amount_refunded_cents = v_order.buyer_total_cents THEN
    UPDATE tickets SET status = 'void' WHERE order_id = v_order.id AND status = 'valid';
    GET DIAGNOSTICS v_voided = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'recorded_cents', v_delta,
    'refunded_cents', p_amount_refunded_cents, 'tickets_voided', v_voided,
    'full', p_amount_refunded_cents = v_order.buyer_total_cents);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ─── record_application_fee_refund ─────────────────────────────────────────
-- From `application_fee.refunded` on the PLATFORM. Cumulative, like refunds.
CREATE OR REPLACE FUNCTION record_application_fee_refund(
  p_payment_intent_id TEXT, p_account_id TEXT, p_fee_refunded_cents BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_order orders%ROWTYPE; v_delta BIGINT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.charge_model <> 'direct' OR v_order.stripe_account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_fee_refunded_cents IS NULL OR p_fee_refunded_cents < 0
     OR p_fee_refunded_cents > v_order.commission_cents + v_order.commission_tax_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR');
  END IF;

  v_delta := p_fee_refunded_cents - v_order.application_fee_refunded_cents;
  IF v_delta <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_recorded', true, 'order_id', v_order.id);
  END IF;

  -- Eventsli gives back part of its fee: the commission debit is reversed.
  PERFORM ledger_write(v_order.event_id, v_order.organizer_id, v_order.id, v_order.channel,
    'commission', 'credit', v_delta, v_order.currency,
    'fee_refund_' || v_order.id || '_' || p_fee_refunded_cents);
  UPDATE orders SET application_fee_refunded_cents = p_fee_refunded_cents WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'recorded_cents', v_delta);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ─── record_stripe_dispute ─────────────────────────────────────────────────
-- From `charge.dispute.*` on the organizer's account. The dispute is debited
-- from the ORGANIZER's balance by Stripe (direct charge); this records what
-- happened. Funds withdrawn / reinstated are ledger `adjustment`s keyed on the
-- dispute, so each is written at most once. A LOST dispute voids unused tickets.
CREATE OR REPLACE FUNCTION record_stripe_dispute(
  p_payment_intent_id TEXT, p_account_id TEXT, p_charge_id TEXT,
  p_dispute_id TEXT, p_status TEXT, p_amount_cents BIGINT, p_movement TEXT
) RETURNS JSONB AS $$
DECLARE
  v_order orders%ROWTYPE; v_voided INT := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.charge_model = 'direct' AND v_order.stripe_account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 OR p_amount_cents > v_order.buyer_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR');
  END IF;

  UPDATE orders
     SET dispute_status = p_status,
         disputed_cents = p_amount_cents,
         stripe_charge_id = COALESCE(stripe_charge_id, p_charge_id)
   WHERE id = v_order.id;

  IF p_movement = 'withdrawn' THEN
    PERFORM ledger_write(v_order.event_id, v_order.organizer_id, v_order.id, v_order.channel,
      'adjustment', 'debit', p_amount_cents, v_order.currency, 'dispute_withdrawn_' || p_dispute_id);
  ELSIF p_movement = 'reinstated' THEN
    PERFORM ledger_write(v_order.event_id, v_order.organizer_id, v_order.id, v_order.channel,
      'adjustment', 'credit', p_amount_cents, v_order.currency, 'dispute_reinstated_' || p_dispute_id);
  END IF;

  IF p_status = 'lost' THEN
    UPDATE tickets SET status = 'void' WHERE order_id = v_order.id AND status = 'valid';
    GET DIAGNOSTICS v_voided = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'status', p_status,
    'tickets_voided', v_voided);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION fulfill_checkout(UUID, payment_channel, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fulfill_checkout(UUID, payment_channel, JSONB, JSONB, JSONB) TO service_role;
REVOKE ALL ON FUNCTION record_stripe_refund(TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_stripe_refund(TEXT, TEXT, TEXT, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION record_application_fee_refund(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_application_fee_refund(TEXT, TEXT, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION record_stripe_dispute(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_stripe_dispute(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
