-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 — international offline checkout (owner request 2026-11-17).
--
-- A buyer reserves seats or tickets online and pays the ORGANIZER directly —
-- bank transfer, cash, mobile money — using the instructions the organizer
-- wrote. The organizer marks the payment received; only then is an order
-- created and tickets issued. Unpaid reservations expire and give their seats
-- back. Paid orders taken outside Stripe (these and door sales) can be voided
-- or refunded, which voids the tickets, frees the stock and reverses the
-- commission Eventsli was owed.
--
-- SHIPS DARK. Nothing here changes behaviour until a super admin sets
-- `offline_checkout.enabled` to true. Requires 20261121090000_global_markets.sql
-- only for the markets table that phase 1 adds; it does not alter anything
-- phase 1 created.
--
--   offline_payments   one per reservation that chose to pay offline: the
--                      frozen quote, the chosen method (with its instructions
--                      as the buyer saw them), a reference code, a deadline
--   payment_audit      append-only record of every payment action — reserve,
--                      confirm, cancel, expire, void, refund, door sale —
--                      written INSIDE the functions that act, so no path can
--                      act without leaving the row
--
-- Every function locks the row it changes (FOR UPDATE) before checking state,
-- so two clicks, two staff members, or a click racing the expiry sweep resolve
-- to exactly one outcome.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Settings and columns ─────────────────────────────────────────────────
INSERT INTO platform_settings (key, value)
VALUES ('offline_checkout', '{"enabled": false, "payment_hours": 48, "min_hours_before_event": 2}')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE organizer_payment_methods DROP CONSTRAINT IF EXISTS organizer_payment_methods_kind_check;
ALTER TABLE organizer_payment_methods ADD CONSTRAINT organizer_payment_methods_kind_check
  CHECK (kind IN ('e_transfer', 'bank_transfer', 'cash', 'mobile_money', 'other'));

-- The organizer's own payment window for this event, overriding the platform's.
ALTER TABLE events ADD COLUMN IF NOT EXISTS offline_payment_hours SMALLINT
  CHECK (offline_payment_hours IS NULL OR offline_payment_hours BETWEEN 1 AND 336);

-- Door sale (recorded by the organizer at the door) or online (a buyer's offline
-- reservation, confirmed). Both are channel 'manual', so commission invoicing
-- treats them alike; this keeps the Door sales list to door sales.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_source TEXT NOT NULL DEFAULT 'door'
  CHECK (manual_source IN ('door', 'online'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES profiles(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_kind TEXT CHECK (void_kind IN ('void', 'refund'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ─── offline_payments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offline_payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id         UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  event_id               UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  organizer_id           UUID NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL DEFAULT 'awaiting'
                         CHECK (status IN ('awaiting', 'paid', 'expired', 'cancelled', 'voided', 'refunded')),
  currency               CHAR(3) NOT NULL,
  amount_cents           BIGINT NOT NULL CHECK (amount_cents > 0),
  breakdown              JSONB NOT NULL,
  buyer                  JSONB NOT NULL,
  method_id              UUID REFERENCES organizer_payment_methods(id) ON DELETE SET NULL,
  method                 JSONB NOT NULL,          -- kind, label, instructions — as the buyer saw them
  reference_code         TEXT NOT NULL UNIQUE,
  due_at                 TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at           TIMESTAMPTZ,
  confirmed_by           UUID REFERENCES profiles(id),
  received_amount_cents  BIGINT,
  payment_reference      TEXT,
  confirm_key            UUID,
  order_id               UUID REFERENCES orders(id) ON DELETE RESTRICT,
  closed_at              TIMESTAMPTZ,
  closed_by              UUID REFERENCES profiles(id),
  close_reason           TEXT,
  CONSTRAINT offline_paid_has_order CHECK (status NOT IN ('paid', 'voided', 'refunded') OR order_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS offline_payments_event_idx ON offline_payments (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS offline_payments_organizer_idx ON offline_payments (organizer_id, status);

ALTER TABLE offline_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offline_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON offline_payments TO service_role;

-- ─── payment_audit (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_audit (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  action              TEXT NOT NULL,
  event_id            UUID NOT NULL,
  organizer_id        UUID NOT NULL,
  order_id            UUID,
  offline_payment_id  UUID,
  amount_cents        BIGINT,
  currency            CHAR(3),
  actor_id            UUID,
  actor_role          TEXT NOT NULL CHECK (actor_role IN ('buyer', 'organizer', 'admin', 'system')),
  reason              TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS payment_audit_event_idx ON payment_audit (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_audit_order_idx ON payment_audit (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_audit_offline_idx ON payment_audit (offline_payment_id) WHERE offline_payment_id IS NOT NULL;

ALTER TABLE payment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON payment_audit TO service_role;

CREATE OR REPLACE FUNCTION payment_audit_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_audit is append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_audit_append_only ON payment_audit;
CREATE TRIGGER trg_payment_audit_append_only BEFORE UPDATE OR DELETE ON payment_audit
  FOR EACH ROW EXECUTE FUNCTION payment_audit_is_append_only();

CREATE OR REPLACE FUNCTION payment_audit_write(
  p_action TEXT, p_event_id UUID, p_organizer_id UUID, p_order_id UUID, p_offline_id UUID,
  p_amount BIGINT, p_currency CHAR(3), p_actor UUID, p_role TEXT, p_reason TEXT, p_payload JSONB
) RETURNS VOID AS $$
  INSERT INTO payment_audit (action, event_id, organizer_id, order_id, offline_payment_id,
                             amount_cents, currency, actor_id, actor_role, reason, payload)
  VALUES (p_action, p_event_id, p_organizer_id, p_order_id, p_offline_id,
          p_amount, p_currency, p_actor, p_role, p_reason, COALESCE(p_payload, '{}'));
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Door sales were stored with who recorded them, but not audited. Every one now
-- is, from a trigger, so record_manual_sale does not have to be rewritten.
CREATE OR REPLACE FUNCTION audit_door_sale() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.channel = 'manual' AND NEW.manual_source = 'door' THEN
    PERFORM payment_audit_write('door_sale.recorded', NEW.event_id, NEW.organizer_id, NEW.id, NULL,
      NEW.buyer_total_cents, NEW.currency, NEW.recorded_by, 'organizer', NULL,
      jsonb_build_object('method', NEW.manual_method, 'commission_cents', NEW.commission_cents,
                         'commission_tax_cents', NEW.commission_tax_cents));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS trg_audit_door_sale ON orders;
CREATE TRIGGER trg_audit_door_sale AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_door_sale();

-- ─── Reserve ──────────────────────────────────────────────────────────────
-- The buyer chose to pay the organizer. Extends the hold to the payment
-- deadline and freezes the price. A second call for the same reservation
-- returns the first — the same reservation never has two offline payments.
CREATE OR REPLACE FUNCTION offline_reserve(
  p_reservation_id UUID, p_method_id UUID, p_breakdown JSONB, p_buyer JSONB, p_due_at TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  v_res    RECORD;
  v_event  RECORD;
  v_method RECORD;
  v_existing offline_payments;
  v_id     UUID;
  v_code   TEXT;
  v_amount BIGINT := (p_breakdown->>'buyerTotalCents')::BIGINT;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND', 'message', 'That hold no longer exists.');
  END IF;

  SELECT * INTO v_existing FROM offline_payments WHERE reservation_id = p_reservation_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'awaiting' THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'offline_payment_id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'This reservation already ended (' || v_existing.status || '). Start again from the event page.');
  END IF;

  IF v_res.state <> 'active' OR v_res.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED', 'message', 'That hold has expired. Choose your tickets again.');
  END IF;
  -- A card session already open on this hold could still be paid. Two ways to
  -- pay for one hold is how a buyer pays twice.
  IF v_res.attendee_data ? 'stripeSessionId' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'A card payment was started for these tickets. Finish it, or wait for it to expire and choose again.');
  END IF;

  SELECT id, organizer_id, currency, status, starts_at, accepts_manual INTO v_event FROM events WHERE id = v_res.event_id;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED', 'message', 'This event is not on sale.');
  END IF;
  IF v_event.accepts_manual IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FEATURE_DISABLED', 'message', 'This event does not take offline payment.');
  END IF;

  SELECT id, kind, label, instructions INTO v_method FROM organizer_payment_methods
   WHERE id = p_method_id AND organizer_id = v_event.organizer_id AND is_active;
  IF v_method.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR', 'message', 'Choose one of the organizer''s payment methods.');
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR', 'message', 'There is nothing to pay — claim free tickets instead.');
  END IF;
  IF p_due_at IS NULL OR p_due_at <= now() + interval '15 minutes' OR p_due_at > v_event.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event starts too soon to pay the organizer offline.');
  END IF;

  -- Short, unambiguous, unique: the buyer writes it in the transfer note.
  LOOP
    v_code := upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM offline_payments WHERE reference_code = v_code);
  END LOOP;

  INSERT INTO offline_payments (reservation_id, event_id, organizer_id, currency, amount_cents, breakdown,
                                buyer, method_id, method, reference_code, due_at)
  VALUES (p_reservation_id, v_res.event_id, v_event.organizer_id, v_event.currency, v_amount, p_breakdown,
          p_buyer, v_method.id,
          jsonb_build_object('kind', v_method.kind, 'label', v_method.label, 'instructions', v_method.instructions),
          v_code, p_due_at)
  RETURNING id INTO v_id;

  -- The hold now lasts until the payment deadline; the sweep releases it then.
  UPDATE reservations SET expires_at = p_due_at WHERE id = p_reservation_id;

  PERFORM payment_audit_write('offline.reserved', v_res.event_id, v_event.organizer_id, NULL, v_id,
    v_amount, v_event.currency, NULLIF(p_buyer->>'user_id', '')::UUID, 'buyer', NULL,
    jsonb_build_object('reference', v_code, 'due_at', p_due_at, 'method', v_method.label,
                       'reservation_id', p_reservation_id));

  RETURN jsonb_build_object('ok', true, 'offline_payment_id', v_id, 'reference_code', v_code, 'due_at', p_due_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Confirm (organizer: Mark as paid) ────────────────────────────────────
-- The only way an offline reservation becomes tickets. Exactly the amount owed:
-- more is refused (an overpayment is the organizer's to return, not ours to
-- absorb into a sale), less is refused (partial payment issues nothing). A
-- second confirmation — same key or not — returns the first order.
CREATE OR REPLACE FUNCTION offline_confirm(
  p_offline_id UUID, p_organizer_id UUID, p_actor UUID, p_amount_cents BIGINT,
  p_reference TEXT, p_confirm_key UUID
) RETURNS JSONB AS $$
DECLARE
  v        offline_payments;
  v_res    RECORD;
  v_event  RECORD;
  v_order  UUID;
  v_seats  UUID[];
  v_tables UUID[];
  v_n      INT := 0;
  v_g      INT := 0;
  v_promo_id UUID; v_promo_code TEXT;
  b        JSONB;
BEGIN
  SELECT * INTO v FROM offline_payments WHERE id = p_offline_id FOR UPDATE;
  IF v.id IS NULL OR v.organizer_id <> p_organizer_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That reservation is not one of yours.');
  END IF;

  IF v.status IN ('paid', 'voided', 'refunded') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'order_id', v.order_id, 'status', v.status);
  END IF;
  IF v.status <> 'awaiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'This reservation is ' || v.status || ' — its seats were released. Ask the buyer to reserve again.');
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <> v.amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', CASE WHEN p_amount_cents > v.amount_cents
        THEN 'That is more than this reservation costs. Record exactly the amount owed and return the difference to the buyer.'
        ELSE 'That is less than this reservation costs. Mark it paid only once the full amount has arrived.' END,
      'amount_cents', v.amount_cents);
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = v.reservation_id FOR UPDATE;
  IF v_res.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED',
      'message', 'The payment deadline passed and the seats were released. Ask the buyer to reserve again.');
  END IF;

  SELECT id, organizer_id, currency, status, payment_fee_mode INTO v_event FROM events WHERE id = v.event_id;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is no longer on sale, so no tickets can be issued.');
  END IF;

  b := v.breakdown;
  SELECT pr.promo_id, pc.code INTO v_promo_id, v_promo_code
    FROM promo_redemptions pr JOIN promo_codes pc ON pc.id = pr.promo_id
   WHERE pr.reservation_id = v.reservation_id;

  INSERT INTO orders (
    event_id, organizer_id, user_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, discount_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents, payment_fee_mode, stripe_cost_cents, platform_net_cents,
    guest_name, guest_email, guest_phone, paid_at, promo_id, promo_code,
    manual_method, manual_note, recorded_by, manual_source
  ) VALUES (
    v.event_id, v.organizer_id, NULLIF(v.buyer->>'user_id', '')::UUID, v.reservation_id, 'manual', 'paid', v.currency,
    (b->>'quantity')::INT, (b->>'subtotalCents')::BIGINT, COALESCE((b->>'discountCents')::BIGINT, 0),
    COALESCE((b->>'eventTaxCents')::BIGINT, 0),
    COALESCE((b->>'commissionCents')::BIGINT, 0), COALESCE((b->>'commissionTaxCents')::BIGINT, 0), 0,
    'organizer', (b->>'buyerTotalCents')::BIGINT, GREATEST(COALESCE((b->>'organizerNetCents')::BIGINT, 0), 0),
    'manual', 0, COALESCE((b->>'platformNetCents')::BIGINT, 0),
    v.buyer->>'name', NULLIF(v.buyer->>'email', ''), NULLIF(v.buyer->>'phone', ''), now(), v_promo_id, v_promo_code,
    v.method->>'label', NULLIF(btrim(p_reference), ''), p_actor, 'online'
  ) RETURNING id INTO v_order;

  IF v_promo_id IS NOT NULL THEN
    UPDATE promo_redemptions SET order_id = v_order WHERE reservation_id = v.reservation_id;
  END IF;

  PERFORM copy_reservation_items_to_order(v.reservation_id, v_order);

  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL),
         array_agg(table_id) FILTER (WHERE table_id IS NOT NULL)
    INTO v_seats, v_tables FROM reservation_items WHERE reservation_id = v.reservation_id;
  IF v_tables IS NOT NULL THEN
    SELECT COALESCE(v_seats, ARRAY[]::UUID[]) || COALESCE(array_agg(s.id), ARRAY[]::UUID[])
      INTO v_seats FROM seats s WHERE s.table_id = ANY(v_tables) AND s.held_by_reservation = v.reservation_id;
    UPDATE tables SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_tables);
  END IF;
  UPDATE seats SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_seats);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order, v.event_id, s.id, s.table_id, s.tier_id, NULL FROM seats s WHERE s.id = ANY(v_seats);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order, v.event_id, NULL, NULL, ri.tier_id, NULL
    FROM reservation_items ri CROSS JOIN generate_series(1, ri.quantity)
   WHERE ri.reservation_id = v.reservation_id AND ri.seat_id IS NULL AND ri.table_id IS NULL;
  GET DIAGNOSTICS v_g = ROW_COUNT;

  -- Eventsli's commission is OWED by the organizer (channel 'manual' ledger =
  -- the commission account, as for door sales) and invoiced with them.
  IF COALESCE((b->>'commissionCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(v.event_id, v.organizer_id, v_order, 'manual', 'commission', 'credit',
      (b->>'commissionCents')::BIGINT, v.currency, 'm_commission_' || v_order);
  END IF;
  IF COALESCE((b->>'commissionTaxCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(v.event_id, v.organizer_id, v_order, 'manual', 'commission_tax', 'credit',
      (b->>'commissionTaxCents')::BIGINT, v.currency, 'm_commission_tax_' || v_order);
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = v.reservation_id;
  UPDATE offline_payments
     SET status = 'paid', confirmed_at = now(), confirmed_by = p_actor, received_amount_cents = p_amount_cents,
         payment_reference = NULLIF(btrim(p_reference), ''), confirm_key = p_confirm_key, order_id = v_order
   WHERE id = v.id;

  PERFORM payment_audit_write('offline.confirmed', v.event_id, v.organizer_id, v_order, v.id,
    p_amount_cents, v.currency, p_actor, 'organizer', NULL,
    jsonb_build_object('reference', NULLIF(btrim(p_reference), ''), 'reference_code', v.reference_code,
                       'tickets', v_n + v_g, 'commission_cents', COALESCE((b->>'commissionCents')::BIGINT, 0)));

  RETURN jsonb_build_object('ok', true, 'order_id', v_order, 'ticket_count', v_n + v_g, 'currency', v.currency);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Cancel an unpaid reservation (buyer or organizer) ────────────────────
CREATE OR REPLACE FUNCTION offline_cancel(
  p_offline_id UUID, p_actor UUID, p_role TEXT, p_organizer_id UUID, p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v offline_payments;
BEGIN
  SELECT * INTO v FROM offline_payments WHERE id = p_offline_id FOR UPDATE;
  IF v.id IS NULL OR (p_organizer_id IS NOT NULL AND v.organizer_id <> p_organizer_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That reservation does not exist.');
  END IF;
  IF v.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF v.status <> 'awaiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'This reservation is ' || v.status || ' and cannot be cancelled.' ||
                 CASE WHEN v.status = 'paid' THEN ' Void or refund the order instead.' ELSE '' END);
  END IF;

  UPDATE offline_payments SET status = 'cancelled', closed_at = now(), closed_by = p_actor,
         close_reason = NULLIF(btrim(p_reason), '') WHERE id = v.id;
  -- release_reservation (redefined below) releases the seats, the promo use
  -- and the hold; it sees the payment already cancelled.
  PERFORM release_reservation(v.reservation_id);

  PERFORM payment_audit_write('offline.cancelled', v.event_id, v.organizer_id, NULL, v.id,
    v.amount_cents, v.currency, p_actor, p_role, NULLIF(btrim(p_reason), ''),
    jsonb_build_object('reference_code', v.reference_code));
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Void or refund a paid order taken outside Stripe ─────────────────────
-- Void: recorded in error, no money changed hands. Refund: the organizer gave
-- the buyer their money back. Either way: tickets void (the door refuses
-- them), seats and tickets back on sale (sold_count follows the tickets), and
-- the commission Eventsli was owed on it reversed. Refused once anyone on the
-- order has been admitted. Card orders are refunded in Stripe, not here.
CREATE OR REPLACE FUNCTION order_void_offline(
  p_order_id UUID, p_organizer_id UUID, p_actor UUID, p_role TEXT, p_kind TEXT, p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  o        orders;
  v_seats  UUID[];
  v_voided INT := 0;
BEGIN
  IF p_kind NOT IN ('void', 'refund') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR', 'message', 'Choose void or refund.');
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR', 'message', 'Say why, in a few words.');
  END IF;

  SELECT * INTO o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL OR (p_organizer_id IS NOT NULL AND o.organizer_id <> p_organizer_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That order does not exist.');
  END IF;
  IF o.channel <> 'manual' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'Card orders are refunded in Stripe; Eventsli records it automatically.');
  END IF;
  IF o.status = 'cancelled' AND o.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'kind', o.void_kind);
  END IF;
  IF o.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT', 'message', 'Only a paid order can be voided or refunded.');
  END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE order_id = o.id AND status = 'scanned') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'Someone on this order has already been admitted, so it cannot be voided.');
  END IF;

  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL) INTO v_seats FROM tickets WHERE order_id = o.id;

  UPDATE tickets SET status = 'void' WHERE order_id = o.id AND status = 'valid';
  GET DIAGNOSTICS v_voided = ROW_COUNT;
  IF v_seats IS NOT NULL THEN
    -- The table's status follows its seats (trg_sync_table_status).
    UPDATE seats SET status = 'available', held_by_reservation = NULL WHERE id = ANY(v_seats) AND status = 'sold';
  END IF;

  UPDATE orders SET status = 'cancelled', voided_at = now(), voided_by = p_actor, void_kind = p_kind,
         void_reason = btrim(p_reason),
         refunded_cents = CASE WHEN p_kind = 'refund' THEN buyer_total_cents ELSE refunded_cents END
   WHERE id = o.id;

  -- Commission reversed: the organizer no longer owes it on this order. If it
  -- was already invoiced and paid, the ledger runs negative — a credit the next
  -- invoice nets off (or an admin returns).
  IF o.commission_cents > 0 THEN
    PERFORM ledger_write(o.event_id, o.organizer_id, o.id, 'manual', 'commission', 'debit',
      o.commission_cents, o.currency, 'm_commission_reversal_' || o.id);
  END IF;
  IF o.commission_tax_cents > 0 THEN
    PERFORM ledger_write(o.event_id, o.organizer_id, o.id, 'manual', 'commission_tax', 'debit',
      o.commission_tax_cents, o.currency, 'm_commission_tax_reversal_' || o.id);
  END IF;

  UPDATE offline_payments SET status = CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END,
         closed_at = now(), closed_by = p_actor, close_reason = btrim(p_reason)
   WHERE order_id = o.id;

  PERFORM payment_audit_write('order.' || CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END,
    o.event_id, o.organizer_id, o.id, NULL, o.buyer_total_cents, o.currency, p_actor, p_role, btrim(p_reason),
    jsonb_build_object('source', o.manual_source, 'tickets_voided', v_voided,
                       'commission_reversed_cents', o.commission_cents + o.commission_tax_cents));

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'tickets_voided', v_voided,
    'commission_reversed_cents', o.commission_cents + o.commission_tax_cents);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── The sweep and the release know about offline payments ────────────────
-- Same functions as 20261106 / earlier, plus: an awaiting offline payment whose
-- reservation is expired or released is closed with it, and audited.
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INTEGER AS $$
DECLARE
  v_ids    UUID[];
  v_promos UUID[];
  r        RECORD;
BEGIN
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

  -- Offline payments that were not marked paid in time.
  FOR r IN
    UPDATE offline_payments SET status = 'expired', closed_at = now(), close_reason = 'payment deadline passed'
     WHERE reservation_id = ANY(v_ids) AND status = 'awaiting'
    RETURNING id, event_id, organizer_id, amount_cents, currency, reference_code, due_at
  LOOP
    PERFORM payment_audit_write('offline.expired', r.event_id, r.organizer_id, NULL, r.id,
      r.amount_cents, r.currency, NULL, 'system', 'payment deadline passed',
      jsonb_build_object('reference_code', r.reference_code, 'due_at', r.due_at));
  END LOOP;

  RETURN array_length(v_ids, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION release_reservation(p_reservation_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_state reservation_state;
  v_seats INT;
  v_promo UUID;
  v_off   offline_payments;
BEGIN
  SELECT state INTO v_state FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND');
  END IF;

  IF v_state = 'converted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'That reservation has already been paid for.');
  END IF;

  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE held_by_reservation = p_reservation_id;
  GET DIAGNOSTICS v_seats = ROW_COUNT;

  UPDATE tables SET held_by_reservation = NULL
   WHERE held_by_reservation = p_reservation_id;

  DELETE FROM reservation_items WHERE reservation_id = p_reservation_id;

  DELETE FROM promo_redemptions
   WHERE reservation_id = p_reservation_id AND order_id IS NULL
  RETURNING promo_id INTO v_promo;

  IF v_promo IS NOT NULL THEN
    UPDATE promo_codes
       SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo)
     WHERE id = v_promo;
  END IF;

  UPDATE reservations SET state = 'released', promo_id = NULL WHERE id = p_reservation_id;

  -- Released some other way (the buyer's "start again") while awaiting payment.
  UPDATE offline_payments SET status = 'cancelled', closed_at = now(), close_reason = 'hold released'
   WHERE reservation_id = p_reservation_id AND status = 'awaiting'
  RETURNING * INTO v_off;
  IF v_off.id IS NOT NULL THEN
    PERFORM payment_audit_write('offline.cancelled', v_off.event_id, v_off.organizer_id, NULL, v_off.id,
      v_off.amount_cents, v_off.currency, NULL, 'buyer', 'hold released',
      jsonb_build_object('reference_code', v_off.reference_code));
  END IF;

  RETURN jsonb_build_object('ok', true, 'seats_released', v_seats);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A hold waiting on an offline payment must never also get a card session: the
-- buyer could pay twice. The checkout controller asks this before opening one,
-- and offline_reserve refuses a hold that already has a card session — so the
-- two can never both be open on one reservation.
CREATE OR REPLACE FUNCTION offline_payment_pending(p_reservation_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM offline_payments WHERE reservation_id = p_reservation_id AND status = 'awaiting');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Commission invoices count door sales and confirmed offline orders that are
-- still paid; a voided order is not a sale. Same function otherwise.
CREATE OR REPLACE FUNCTION raise_commission_invoice(p_event_id UUID, p_admin_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_event   RECORD;
  v_open    UUID;
  v_owed    BIGINT;
  v_from    TIMESTAMPTZ;
  v_count   INT;
  v_seq     INT;
  v_id      UUID;
  v_number  TEXT;
BEGIN
  SELECT id, organizer_id, currency, starts_at INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN invoice_fail('EVENT_NOT_FOUND', 'That event does not exist.');
  END IF;

  SELECT id INTO v_open FROM invoices
   WHERE event_id = p_event_id AND status IN ('open', 'submitted', 'overdue')
   LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN invoice_fail('CONFLICT', 'There is already an unpaid invoice for this event.')
           || jsonb_build_object('invoice_id', v_open);
  END IF;

  v_owed := manual_commission_owed(p_event_id, v_event.currency);
  IF v_owed <= 0 THEN
    RETURN invoice_fail('CONFLICT', 'Nothing is outstanding for this event.');
  END IF;

  SELECT COALESCE(MAX(covers_to), '-infinity'::TIMESTAMPTZ) INTO v_from
    FROM invoices WHERE event_id = p_event_id AND status::TEXT <> 'void';

  SELECT count(*) INTO v_count FROM orders
   WHERE event_id = p_event_id AND channel = 'manual' AND status = 'paid' AND created_at > v_from;

  SELECT count(*) + 1 INTO v_seq FROM invoices WHERE event_id = p_event_id;
  v_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_event_id::TEXT, 1, 8) || '-' || v_seq;

  INSERT INTO invoices (organizer_id, event_id, number, currency, amount_cents, status,
                        covers_from, covers_to, order_count)
  VALUES (v_event.organizer_id, p_event_id, v_number, v_event.currency, v_owed, 'open',
          NULLIF(v_from, '-infinity'::TIMESTAMPTZ), now(), v_count)
  RETURNING id INTO v_id;

  PERFORM invoice_log(v_id, 'raised', CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
                      p_admin_id, v_owed, NULL, jsonb_build_object('order_count', v_count));

  RETURN invoice_result(v_id, jsonb_build_object('order_count', v_count));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION payment_audit_write(TEXT, UUID, UUID, UUID, UUID, BIGINT, CHAR, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION offline_reserve(UUID, UUID, JSONB, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION offline_confirm(UUID, UUID, UUID, BIGINT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION offline_cancel(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION order_void_offline(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION offline_payment_pending(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION offline_reserve(UUID, UUID, JSONB, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION offline_confirm(UUID, UUID, UUID, BIGINT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION offline_cancel(UUID, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION order_void_offline(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION offline_payment_pending(UUID) TO service_role;
