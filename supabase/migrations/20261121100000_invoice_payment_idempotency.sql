-- ═══════════════════════════════════════════════════════════════════════════
-- A commission payment is recorded ONCE (owner request 2026-11-17).
--
-- `invoice_record_payment` locked the invoice and refused anything above the
-- balance, so it could never be overpaid. But a PARTIAL payment recorded twice
-- — a double-click, a retried request after a timeout, two admins entering the
-- same bank line — passed both times, because each one was still under the
-- balance. The organizer then appeared to have paid twice what they did.
--
-- Two guards, both inside the same row lock:
--
--   idempotency_key   each Record payment form carries a key the browser makes
--                     once. The same key again returns the FIRST payment —
--                     `duplicate: true` — and records nothing.
--   reference         a bank or transfer reference already recorded on this
--                     invoice, and not reversed, is refused: it is the same
--                     money. A payment with no reference is not compared.
--
-- Independent of the global-markets migrations: it touches invoices only.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_idempotency_uq
  ON invoice_payments (invoice_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS invoice_record_payment(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID);

CREATE OR REPLACE FUNCTION invoice_record_payment(
  p_invoice_id UUID, p_amount_cents BIGINT, p_method TEXT, p_reference TEXT,
  p_received_at TIMESTAMPTZ, p_note TEXT, p_admin_id UUID,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v        invoices;
  v_bal    BIGINT;
  v_pay    UUID := gen_random_uuid();
  v_prior  UUID;
  v_status invoice_status;
  v_ref    TEXT := NULLIF(btrim(p_reference), '');
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;

  -- The same form submitted again: answer with what the first one did. Asked
  -- BEFORE the status check, so a retry after the invoice settled is a quiet
  -- success rather than "there is nothing to pay on it".
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_prior FROM invoice_payments
     WHERE invoice_id = v.id AND idempotency_key = p_idempotency_key;
    IF v_prior IS NOT NULL THEN
      RETURN invoice_result(v.id, jsonb_build_object('payment_id', v_prior, 'duplicate', true,
                                                     'settled', v.status = 'paid'));
    END IF;
  END IF;

  IF v.status::TEXT IN ('void', 'waived', 'paid') THEN
    RETURN invoice_fail('CONFLICT', 'This invoice is ' || v.status::TEXT || ' — there is nothing to pay on it.');
  END IF;

  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Enter the amount that arrived.');
  END IF;
  IF p_amount_cents > v_bal THEN
    RETURN invoice_fail('VALIDATION_ERROR',
      'That is more than the balance still owed on this invoice. Record what arrived for this invoice only.');
  END IF;
  IF p_received_at IS NOT NULL AND p_received_at > now() + interval '1 day' THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'A payment cannot have arrived in the future.');
  END IF;

  IF v_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM invoice_payments
     WHERE invoice_id = v.id AND reversed_at IS NULL AND lower(reference) = lower(v_ref)
  ) THEN
    RETURN invoice_fail('CONFLICT',
      'A payment with reference "' || v_ref || '" is already recorded on this invoice. Reverse that one first if it was wrong.');
  END IF;

  INSERT INTO invoice_payments (id, invoice_id, amount_cents, currency, method, reference, received_at,
                                note, recorded_by, ledger_key, idempotency_key)
  VALUES (v_pay, v.id, p_amount_cents, v.currency, btrim(COALESCE(NULLIF(btrim(p_method), ''), 'bank transfer')),
          v_ref, COALESCE(p_received_at, now()), NULLIF(btrim(p_note), ''),
          p_admin_id, 'pay_' || v_pay::TEXT, p_idempotency_key);

  PERFORM invoice_ledger(v, 'settlement', 'debit', p_amount_cents, 'pay_' || v_pay::TEXT,
                         jsonb_build_object('payment_id', v_pay));

  UPDATE invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = v.id;

  PERFORM invoice_log(v.id, 'payment_recorded', 'admin', p_admin_id, p_amount_cents, p_note,
    jsonb_build_object('payment_id', v_pay, 'method', p_method, 'reference', v_ref,
                       'received_at', COALESCE(p_received_at, now())));

  v_status := invoice_refresh_status(v.id, p_admin_id);
  IF v_status = 'paid' THEN
    PERFORM invoice_log(v.id, 'settled', 'admin', p_admin_id, v.amount_cents, NULL, '{}');
  END IF;

  RETURN invoice_result(v.id, jsonb_build_object('payment_id', v_pay, 'settled', v_status = 'paid'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION invoice_record_payment(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION invoice_record_payment(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID)
  TO service_role;
