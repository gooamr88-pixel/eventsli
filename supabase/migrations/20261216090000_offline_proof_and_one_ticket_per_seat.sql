-- ═══════════════════════════════════════════════════════════════════════════
-- OFFLINE PAYMENTS: PROOF OF PAYMENT, AND ONE LIVE TICKET PER SEAT (2026-11-24).
--
-- The owner's checklist for paying the organizer offline:
--   · Proof of payment — the buyer can upload a photo of the transfer receipt;
--   · an audit record of who confirmed the payment and when (payment_audit,
--     20261122090000 — this adds the receipt upload to it);
--   · never two tickets for the same seat.
--
-- 1. offline_payments.proof_* — the buyer's receipt: where it is stored (in
--    the PRIVATE bucket below; only signed, short-lived links ever reach a
--    browser), its type and when it arrived. Replacing it keeps the newest.
-- 2. offline_attach_proof — records the upload under a row lock, only while
--    the payment is still awaited, and writes `offline.proof_uploaded` to the
--    append-only payment_audit.
-- 3. tickets_one_live_per_seat — the database refuses a second valid or
--    scanned ticket for a seat. Holds already stop it in every sale path; this
--    is the guarantee under all of them, so no future path can sell a seat
--    twice. A voided ticket does not count: the seat may be sold again.
--    Refuses to install, naming the count, if the data already breaks it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE offline_payments ADD COLUMN IF NOT EXISTS proof_path TEXT;
ALTER TABLE offline_payments ADD COLUMN IF NOT EXISTS proof_content_type TEXT;
ALTER TABLE offline_payments ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;

-- ── The receipts bucket: private ──────────────────────────────────────────
-- Guarded on the table, as 20260905090000 explains (CI runs without storage).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'payment-proofs',
      'payment-proofs',
      false,
      10485760,                                            -- 10 MB
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
      SET public             = EXCLUDED.public,
          file_size_limit    = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ── Record a receipt ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION offline_attach_proof(p_offline_id UUID, p_path TEXT, p_content_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v offline_payments%ROWTYPE;
  v_previous TEXT;
BEGIN
  SELECT * INTO v FROM offline_payments WHERE id = p_offline_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That reservation was not found.');
  END IF;
  IF v.status <> 'awaiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'This reservation is no longer waiting for payment, so a receipt cannot be added.');
  END IF;
  v_previous := v.proof_path;
  UPDATE offline_payments
     SET proof_path = p_path, proof_content_type = p_content_type, proof_uploaded_at = now()
   WHERE id = p_offline_id;
  PERFORM payment_audit_write('offline.proof_uploaded', v.event_id, v.organizer_id, NULL, v.id,
    v.amount_cents, v.currency, NULL, 'buyer', NULL,
    jsonb_build_object('reference_code', v.reference_code, 'content_type', p_content_type,
                       'replaced', v_previous IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'previous_path', v_previous);
END;
$$;
REVOKE ALL ON FUNCTION offline_attach_proof(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION offline_attach_proof(UUID, TEXT, TEXT) TO service_role;

-- ── One live ticket per seat ──────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT seat_id FROM tickets
     WHERE seat_id IS NOT NULL AND status <> 'void'
     GROUP BY seat_id HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'TICKETS_SHARE_A_SEAT: % seat(s) already hold more than one live ticket. Void the extra ones, then run this migration again.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_live_per_seat
  ON tickets (seat_id) WHERE seat_id IS NOT NULL AND status <> 'void';
