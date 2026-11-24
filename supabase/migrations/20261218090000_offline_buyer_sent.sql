-- ═══════════════════════════════════════════════════════════════════════════
-- OFFLINE PAYMENTS: "I'VE SENT THE PAYMENT" (owner, 2026-11-24: "at the end
-- put a confirm, or anything that ends the payment and booking process").
--
-- The buyer's last step on the pay-the-organizer page. It does NOT issue
-- tickets — only the organizer marking the payment received does that. It
-- records that the buyer says the money is on its way, so:
--   · the buyer's page closes the flow ("Payment sent — waiting for the
--     organizer to confirm");
--   · the organizer is emailed once to go and check;
--   · the organizer's list shows "Buyer says sent" beside the reservation.
--
-- offline_mark_sent: under a row lock, only while the payment is awaited. The
-- first press sets buyer_sent_at and writes `offline.buyer_sent` to the
-- append-only payment_audit; pressing again changes nothing (`first` false),
-- so the organizer is never emailed twice.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE offline_payments ADD COLUMN IF NOT EXISTS buyer_sent_at TIMESTAMPTZ;

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
