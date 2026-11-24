-- ═══════════════════════════════════════════════════════════════════════════
-- COMMISSION AS A PERCENTAGE PLUS A FIXED AMOUNT, AND RECEIPTS AN ORGANIZER
-- CAN REQUIRE (owner, 2026-11-24).
--
-- 1. events.commission_fixed_cents — Eventsli's fixed amount PER PAID TICKET,
--    on top of commission_pct ("1.5% + $0.50 per ticket"), in the event's
--    currency. 0 keeps every existing event exactly as it was. Worked out in
--    backend/utils/fees.js with the percentage; never more than the price, and
--    nothing on a free ticket. Admin-only, like commission_pct. Orders keep
--    the commission they were sold at (orders.commission_cents), so changing
--    this moves only future sales.
--
-- 2. organizer_payment_methods.require_proof — the organizer decides, per
--    payment method, whether a buyer paying that way MUST upload a receipt
--    (a Zelle screenshot, a bank slip) before they can say "I've sent the
--    payment". Off by default: cash at a meeting has no receipt.
--
-- 3. offline_payments.proof_required — that choice, frozen onto each
--    reservation when it is made, as its instructions already are. A trigger
--    copies it, so offline_reserve does not need rewriting and no path that
--    inserts a reservation can forget it.
--
-- 4. offline_mark_sent refuses ("RECEIPT_REQUIRED") while a required receipt
--    is missing. The organizer can still mark the payment received — they are
--    the one who can see the money arrive.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS commission_fixed_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_commission_fixed_cents_check;
ALTER TABLE events ADD CONSTRAINT events_commission_fixed_cents_check
  CHECK (commission_fixed_cents >= 0 AND commission_fixed_cents <= 100000000);

ALTER TABLE organizer_payment_methods ADD COLUMN IF NOT EXISTS require_proof BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE offline_payments ADD COLUMN IF NOT EXISTS proof_required BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION offline_payment_freeze_proof_rule() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.method_id IS NOT NULL THEN
    SELECT COALESCE(m.require_proof, false) INTO NEW.proof_required
      FROM organizer_payment_methods m WHERE m.id = NEW.method_id;
    NEW.proof_required := COALESCE(NEW.proof_required, false);
  END IF;
  NEW.method := COALESCE(NEW.method, '{}'::jsonb) || jsonb_build_object('require_proof', NEW.proof_required);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_offline_payment_freeze_proof_rule ON offline_payments;
CREATE TRIGGER trg_offline_payment_freeze_proof_rule BEFORE INSERT ON offline_payments
  FOR EACH ROW EXECUTE FUNCTION offline_payment_freeze_proof_rule();

CREATE OR REPLACE FUNCTION offline_mark_sent(p_offline_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v offline_payments%ROWTYPE;
BEGIN
  SELECT * INTO v FROM offline_payments WHERE id = p_offline_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That reservation was not found.');
  END IF;
  IF v.status <> 'awaiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'This reservation is no longer waiting for payment.');
  END IF;
  IF v.proof_required AND v.proof_uploaded_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RECEIPT_REQUIRED',
      'message', 'The organizer needs your payment receipt. Upload a photo or screenshot of it first.');
  END IF;
  IF v.buyer_sent_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'first', false);
  END IF;
  UPDATE offline_payments SET buyer_sent_at = now() WHERE id = p_offline_id;
  PERFORM payment_audit_write('offline.buyer_sent', v.event_id, v.organizer_id, NULL, v.id,
    v.amount_cents, v.currency, NULL, 'buyer', NULL,
    jsonb_build_object('reference_code', v.reference_code, 'with_receipt', v.proof_uploaded_at IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'first', true);
END;
$$;
REVOKE ALL ON FUNCTION offline_mark_sent(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION offline_mark_sent(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
