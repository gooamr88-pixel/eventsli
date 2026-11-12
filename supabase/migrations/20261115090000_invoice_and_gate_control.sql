-- ═══════════════════════════════════════════════════════════════════════════
-- INVOICE MANAGEMENT AND CHECK-IN CONTROL.
--
-- Commission invoices could be raised and settled, and nothing else. An admin
-- could not record a partial payment, undo a settlement entered by mistake,
-- forgive a debt, cancel an invoice raised in error, give an organizer more
-- time, or turn down a receipt that did not show the money. The gate had one
-- control — a super admin reopening it for 12 to 72 hours — and no way to
-- close one, exempt an event, or switch enforcement off for the platform.
--
-- This migration is the database half of making all of that manageable:
--
--   1. invoice_payments    every payment an admin records; reversible, never edited
--   2. invoice_events      the invoice's history — who did what, when, and why
--   3. invoice_* functions every invoice action, atomic, each writing (1)/(2)
--                          and the ledger, so a balance is always explainable
--   4. scanner_access.mode an admin's decision about one event's gate —
--                          follow the invoices, force open, force closed —
--                          optionally until a time; never undone by a job
--   5. scanner_is_locked   one answer for every door, now reading (4) and the
--                          platform's enforcement policy
--   6. check_in_ticket_v2  an admission a phone ALREADY made offline is
--                          recorded even if the gate closed meanwhile
--
-- ─── ACCOUNTING RULES ──────────────────────────────────────────────────────
--
-- The manual ledger is a receivables ledger (20260830020000): door sales CREDIT
-- what organizers owe; anything that reduces the debt DEBITS it. Rows are
-- append-only, so every correction is a NEW row in the opposite direction:
--
--   payment recorded   settlement  debit   pay_<payment id>
--   payment reversed   settlement  credit  payrev_<payment id>
--   balance waived     adjustment  debit   waive_<history id>   metadata.kind = write_off
--   waiver reopened    adjustment  credit  unwaive_<history id> metadata.kind = write_off_reversed
--
-- Raising and voiding an invoice write no ledger rows: an invoice ASKS for
-- money the ledger already says is owed. Voiding one returns that debt to the
-- "ready to invoice" queue; it does not forgive it.
--
-- `invoices.paid_cents` and `written_off_cents` are maintained by these
-- functions, so a balance is `amount_cents - paid_cents - written_off_cents`
-- without summing anything — and checked against the amount by a constraint.
--
-- ─── ON ENUM VALUES ────────────────────────────────────────────────────────
--
-- `void` is a new invoice status. A value added by ALTER TYPE cannot be USED
-- in the transaction that adds it, so nothing in this file uses it outside a
-- PL/pgSQL body (which is resolved when it runs, after this commits).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'void';

-- ─── 1. Columns on the invoice ─────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paid_cents               BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS written_off_cents        BIGINT NOT NULL DEFAULT 0,
  -- The due date as first communicated, kept when an admin moves it.
  ADD COLUMN IF NOT EXISTS due_at_original          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_rejected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS waived_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waived_by                UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS waive_reason             TEXT,
  ADD COLUMN IF NOT EXISTS voided_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by                UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS void_reason              TEXT;

COMMENT ON COLUMN invoices.paid_cents IS 'Sum of the invoice''s unreversed payments. Maintained by invoice_record_payment / invoice_reverse_payment.';
COMMENT ON COLUMN invoices.written_off_cents IS 'What an admin forgave (invoice_waive). The balance is amount_cents - paid_cents - written_off_cents.';

-- ─── 2. Payments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
  currency             CHAR(3) NOT NULL,
  -- How it arrived, in the admin's words: "bank transfer", "e-transfer".
  method               TEXT NOT NULL CHECK (length(btrim(method)) BETWEEN 2 AND 60),
  -- The bank's or sender's reference, to match a statement line.
  reference            TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 500),
  recorded_by          UUID REFERENCES profiles(id),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ledger_key           TEXT NOT NULL UNIQUE,
  reversed_at          TIMESTAMPTZ,
  reversed_by          UUID REFERENCES profiles(id),
  reversal_reason      TEXT CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 500),
  CONSTRAINT payment_reversal_complete CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (invoice_id, recorded_at);

-- A payment is a record of money that arrived. Only its reversal fields may
-- change, and it is never deleted — a mistake is reversed, not erased.
CREATE OR REPLACE FUNCTION invoice_payments_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only as part of deleting the invoice itself (a cascade runs one trigger
    -- level down), which the ledger already refuses once money has moved.
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'invoice payments are never deleted; reverse the payment instead';
  END IF;
  IF (NEW.invoice_id, NEW.amount_cents, NEW.currency, NEW.method, NEW.reference, NEW.received_at,
      NEW.note, NEW.recorded_by, NEW.recorded_at, NEW.ledger_key)
     IS DISTINCT FROM
     (OLD.invoice_id, OLD.amount_cents, OLD.currency, OLD.method, OLD.reference, OLD.received_at,
      OLD.note, OLD.recorded_by, OLD.recorded_at, OLD.ledger_key) THEN
    RAISE EXCEPTION 'a recorded payment cannot be edited; reverse it and record the right one';
  END IF;
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'that payment was already reversed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_payments_guard ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_guard
  BEFORE UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION invoice_payments_guard();

-- ─── 3. History ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'raised', 'reminder_sent', 'overdue', 'receipt_submitted', 'receipt_rejected',
                  'due_changed', 'payment_recorded', 'payment_reversed', 'settled',
                  'waived', 'reopened', 'voided', 'note')),
  -- 'admin', 'organizer' or 'system' (a scheduled job).
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('admin', 'organizer', 'system')),
  actor_id      UUID REFERENCES profiles(id),
  amount_cents  BIGINT,
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_events_invoice_idx ON invoice_events (invoice_id, created_at);

-- Append-only. A trigger rather than DO INSTEAD rules (as the ledger uses):
-- a rule silently swallows the write, and it also breaks the cascade when an
-- invoice row is removed. Direct edits and deletes are refused out loud.
CREATE OR REPLACE FUNCTION invoice_events_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'invoice history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP RULE IF EXISTS invoice_events_no_update ON invoice_events;
DROP RULE IF EXISTS invoice_events_no_delete ON invoice_events;
DROP TRIGGER IF EXISTS trg_invoice_events_guard ON invoice_events;
CREATE TRIGGER trg_invoice_events_guard
  BEFORE UPDATE OR DELETE ON invoice_events
  FOR EACH ROW EXECUTE FUNCTION invoice_events_guard();

-- Re-applied over a first draft of this file that used RESTRICT.
ALTER TABLE invoice_events DROP CONSTRAINT IF EXISTS invoice_events_invoice_id_fkey;
ALTER TABLE invoice_events ADD CONSTRAINT invoice_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_invoice_id_fkey;
ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

-- ─── 4. Backfill ───────────────────────────────────────────────────────────
UPDATE invoices SET due_at_original = due_at WHERE due_at_original IS NULL;

-- Every invoice settled before this had one full payment, written to the
-- ledger as `settle_<invoice id>`. It becomes a payment row pointing at that
-- same ledger entry, so it can be reversed like any other.
INSERT INTO invoice_payments (invoice_id, amount_cents, currency, method, received_at, note,
                              recorded_by, recorded_at, ledger_key)
SELECT i.id, i.amount_cents, i.currency, 'recorded before payments were itemised',
       COALESCE(i.confirmed_at, now()), i.notes, i.confirmed_by, COALESCE(i.confirmed_at, now()),
       'settle_' || i.id::TEXT
  FROM invoices i
 WHERE i.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id);

UPDATE invoices SET paid_cents = amount_cents WHERE status = 'paid' AND paid_cents = 0;

-- A 'waived' row could only have been set by hand in the database: there was
-- no endpoint. None of them reduced the ledger, so the debt they "forgave" was
-- still counted as owed. Each gets the write-off it should have had.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM invoices WHERE status = 'waived' AND written_off_cents = 0 LOOP
    INSERT INTO ledger_entries (event_id, organizer_id, invoice_id, channel, entry_type, direction,
                                amount_cents, currency, idempotency_key, metadata)
    VALUES (r.event_id, r.organizer_id, r.id, 'manual', 'adjustment', 'debit',
            r.amount_cents - r.paid_cents, r.currency, 'waive_legacy_' || r.id::TEXT,
            jsonb_build_object('kind', 'write_off', 'backfill', true))
    ON CONFLICT (idempotency_key) DO NOTHING;
    UPDATE invoices
       SET written_off_cents = amount_cents - paid_cents,
           waived_at = COALESCE(waived_at, now()),
           waive_reason = COALESCE(waive_reason, 'waived before waivers were recorded')
     WHERE id = r.id;
  END LOOP;
END $$;

-- History for what already happened, so no invoice has an empty timeline.
INSERT INTO invoice_events (invoice_id, kind, actor_role, amount_cents, created_at, detail)
SELECT i.id, 'raised', 'system', i.amount_cents, i.issued_at, jsonb_build_object('backfill', true)
  FROM invoices i
 WHERE NOT EXISTS (SELECT 1 FROM invoice_events e WHERE e.invoice_id = i.id);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoice_money_bounds;
ALTER TABLE invoices ADD CONSTRAINT invoice_money_bounds
  CHECK (paid_cents >= 0 AND written_off_cents >= 0 AND paid_cents + written_off_cents <= amount_cents);

-- The due date as first told, on every new invoice. Named to run after
-- trg_set_invoice_due_at (BEFORE triggers fire in name order).
CREATE OR REPLACE FUNCTION set_invoice_due_original() RETURNS TRIGGER AS $$
BEGIN
  NEW.due_at_original := COALESCE(NEW.due_at_original, NEW.due_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zz_invoice_due_original ON invoices;
CREATE TRIGGER trg_zz_invoice_due_original
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_invoice_due_original();

-- ─── 5. Helpers ────────────────────────────────────────────────────────────

/** A ledger row tied to its invoice. Idempotent on the key. */
CREATE OR REPLACE FUNCTION invoice_ledger(
  p_inv invoices, p_type ledger_type, p_direction ledger_direction,
  p_amount_cents BIGINT, p_key TEXT, p_meta JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
  IF p_amount_cents <= 0 THEN RETURN; END IF;
  INSERT INTO ledger_entries (event_id, organizer_id, invoice_id, channel, entry_type, direction,
                              amount_cents, currency, idempotency_key, metadata)
  VALUES (p_inv.event_id, p_inv.organizer_id, p_inv.id, 'manual', p_type, p_direction,
          p_amount_cents, p_inv.currency, p_key, COALESCE(p_meta, '{}'))
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/** One history row; returns its id (a ledger key for waivers). */
CREATE OR REPLACE FUNCTION invoice_log(
  p_invoice_id UUID, p_kind TEXT, p_role TEXT, p_actor UUID,
  p_amount BIGINT DEFAULT NULL, p_note TEXT DEFAULT NULL, p_detail JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO invoice_events (invoice_id, kind, actor_role, actor_id, amount_cents, note, detail)
  VALUES (p_invoice_id, p_kind, p_role, p_actor, p_amount, NULLIF(btrim(p_note), ''), COALESCE(p_detail, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Puts the status back in line with the money and the dates. The one place a
 * status is derived, so every action agrees on it:
 *
 *   void                       stays void
 *   nothing left to pay        'paid', or 'waived' when part was forgiven
 *   a receipt waiting          'submitted'
 *   past due                   'overdue'
 *   otherwise                  'open'
 */
CREATE OR REPLACE FUNCTION invoice_refresh_status(p_invoice_id UUID, p_admin_id UUID DEFAULT NULL)
RETURNS invoice_status AS $$
DECLARE
  v   invoices;
  v_s invoice_status;
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF v.status::TEXT = 'void' THEN RETURN v.status; END IF;

  IF v.amount_cents - v.paid_cents - v.written_off_cents <= 0 THEN
    v_s := CASE WHEN v.written_off_cents > 0 THEN 'waived'::invoice_status ELSE 'paid'::invoice_status END;
  ELSIF v.status = 'submitted' THEN
    v_s := 'submitted';
  ELSIF v.due_at < now() THEN
    v_s := 'overdue';
  ELSE
    v_s := 'open';
  END IF;

  UPDATE invoices
     SET status = v_s,
         confirmed_at = CASE WHEN v_s = 'paid' THEN COALESCE(confirmed_at, now()) ELSE NULL END,
         confirmed_by = CASE WHEN v_s = 'paid' THEN COALESCE(p_admin_id, confirmed_by) ELSE NULL END
   WHERE id = p_invoice_id;
  RETURN v_s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/** The answer every action returns: the invoice as it now stands. */
CREATE OR REPLACE FUNCTION invoice_result(p_invoice_id UUID, p_extra JSONB DEFAULT '{}')
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
           'ok', true, 'invoice_id', i.id, 'number', i.number, 'status', i.status,
           'amount_cents', i.amount_cents, 'paid_cents', i.paid_cents,
           'written_off_cents', i.written_off_cents,
           'balance_cents', i.amount_cents - i.paid_cents - i.written_off_cents,
           'due_at', i.due_at,
           'remaining_owed_cents', manual_commission_owed(i.event_id, i.currency)
         ) || COALESCE(p_extra, '{}')
    FROM invoices i WHERE i.id = p_invoice_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_fail(p_error TEXT, p_message TEXT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object('ok', false, 'error', p_error, 'message', p_message);
$$ LANGUAGE sql IMMUTABLE;

-- ─── 6. Raising ────────────────────────────────────────────────────────────
-- Now records who raised it, and ignores voided invoices when working out
-- which door sales are new (a voided invoice covered nothing).
DROP FUNCTION IF EXISTS raise_commission_invoice(UUID);
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

  -- One unpaid invoice at a time: two would give the organizer two due dates
  -- for overlapping periods. The event row lock above serialises the numbering.
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
   WHERE event_id = p_event_id AND channel = 'manual' AND created_at > v_from;

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

-- ─── 7. Payments ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION invoice_record_payment(
  p_invoice_id UUID, p_amount_cents BIGINT, p_method TEXT, p_reference TEXT,
  p_received_at TIMESTAMPTZ, p_note TEXT, p_admin_id UUID
) RETURNS JSONB AS $$
DECLARE
  v        invoices;
  v_bal    BIGINT;
  v_pay    UUID := gen_random_uuid();
  v_status invoice_status;
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status::TEXT IN ('void', 'waived', 'paid') THEN
    RETURN invoice_fail('CONFLICT', 'This invoice is ' || v.status::TEXT || ' — there is nothing to pay on it.');
  END IF;

  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Enter the amount that arrived.');
  END IF;
  IF p_amount_cents > v_bal THEN
    RETURN invoice_fail('VALIDATION_ERROR',
      'That is more than is owed on this invoice (' || v_bal || ' cents). Record what arrived for this invoice only.');
  END IF;
  IF p_received_at IS NOT NULL AND p_received_at > now() + interval '1 day' THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'A payment cannot have arrived in the future.');
  END IF;

  INSERT INTO invoice_payments (id, invoice_id, amount_cents, currency, method, reference, received_at,
                                note, recorded_by, ledger_key)
  VALUES (v_pay, v.id, p_amount_cents, v.currency, btrim(COALESCE(NULLIF(btrim(p_method), ''), 'bank transfer')),
          NULLIF(btrim(p_reference), ''), COALESCE(p_received_at, now()), NULLIF(btrim(p_note), ''),
          p_admin_id, 'pay_' || v_pay::TEXT);

  PERFORM invoice_ledger(v, 'settlement', 'debit', p_amount_cents, 'pay_' || v_pay::TEXT,
                         jsonb_build_object('payment_id', v_pay));

  UPDATE invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = v.id;

  PERFORM invoice_log(v.id, 'payment_recorded', 'admin', p_admin_id, p_amount_cents, p_note,
    jsonb_build_object('payment_id', v_pay, 'method', p_method, 'reference', p_reference,
                       'received_at', COALESCE(p_received_at, now())));

  v_status := invoice_refresh_status(v.id, p_admin_id);
  IF v_status = 'paid' THEN
    PERFORM invoice_log(v.id, 'settled', 'admin', p_admin_id, v.amount_cents, NULL, '{}');
  END IF;

  RETURN invoice_result(v.id, jsonb_build_object('payment_id', v_pay, 'settled', v_status = 'paid'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The old one-call settlement, kept: records the whole remaining balance as one
-- payment. Settling twice is still a harmless no-op.
CREATE OR REPLACE FUNCTION settle_invoice(p_invoice_id UUID, p_admin_id UUID, p_note TEXT)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status = 'paid' THEN
    RETURN invoice_result(v.id, jsonb_build_object('already_settled', true));
  END IF;
  RETURN invoice_record_payment(p_invoice_id, v.amount_cents - v.paid_cents - v.written_off_cents,
                                'bank transfer', NULL, now(), p_note, p_admin_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_reverse_payment(p_payment_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE
  p invoice_payments;
  v invoices;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say why the payment is being reversed.');
  END IF;
  SELECT * INTO p FROM invoice_payments WHERE id = p_payment_id;
  IF p IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That payment does not exist.'); END IF;
  SELECT * INTO v FROM invoices WHERE id = p.invoice_id FOR UPDATE;
  SELECT * INTO p FROM invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.reversed_at IS NOT NULL THEN
    RETURN invoice_fail('CONFLICT', 'That payment was already reversed.');
  END IF;
  IF v.status::TEXT = 'void' THEN
    RETURN invoice_fail('CONFLICT', 'This invoice is void.');
  END IF;
  IF v.written_off_cents > 0 THEN
    RETURN invoice_fail('CONFLICT', 'Part of this invoice was waived. Reopen it before reversing a payment.');
  END IF;

  UPDATE invoice_payments
     SET reversed_at = now(), reversed_by = p_admin_id, reversal_reason = btrim(p_reason)
   WHERE id = p.id;
  PERFORM invoice_ledger(v, 'settlement', 'credit', p.amount_cents, 'payrev_' || p.id::TEXT,
                         jsonb_build_object('payment_id', p.id, 'reversal', true));
  UPDATE invoices SET paid_cents = paid_cents - p.amount_cents WHERE id = v.id;

  PERFORM invoice_log(v.id, 'payment_reversed', 'admin', p_admin_id, p.amount_cents, p_reason,
                      jsonb_build_object('payment_id', p.id));
  PERFORM invoice_refresh_status(v.id, p_admin_id);
  RETURN invoice_result(v.id, jsonb_build_object('payment_id', p.id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 8. Waive, reopen, void ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION invoice_waive(p_invoice_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE
  v     invoices;
  v_bal BIGINT;
  v_evt UUID;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say why the balance is being waived — the organizer is told.');
  END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status::TEXT NOT IN ('open', 'submitted', 'overdue') THEN
    RETURN invoice_fail('CONFLICT', 'Only an unpaid invoice can be waived.');
  END IF;
  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents;

  v_evt := invoice_log(v.id, 'waived', 'admin', p_admin_id, v_bal, p_reason, '{}');
  PERFORM invoice_ledger(v, 'adjustment', 'debit', v_bal, 'waive_' || v_evt::TEXT,
                         jsonb_build_object('kind', 'write_off', 'history_id', v_evt));
  UPDATE invoices
     SET written_off_cents = written_off_cents + v_bal,
         waived_at = now(), waived_by = p_admin_id, waive_reason = btrim(p_reason)
   WHERE id = v.id;
  PERFORM invoice_refresh_status(v.id, p_admin_id);
  RETURN invoice_result(v.id, jsonb_build_object('waived_cents', v_bal));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Undoes a waiver: the forgiven amount is owed again, by the invoice's own due
-- date (overdue at once if that has passed — move the date to give more time).
CREATE OR REPLACE FUNCTION invoice_reopen(p_invoice_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE
  v     invoices;
  v_evt UUID;
  v_amt BIGINT;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say why the invoice is being reopened.');
  END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.written_off_cents <= 0 THEN
    RETURN invoice_fail('CONFLICT', 'Nothing on this invoice was waived. A paid invoice is reopened by reversing its payment.');
  END IF;
  -- Another invoice may have been raised for the event since; two unpaid ones
  -- at once is the state `raise_commission_invoice` refuses.
  IF EXISTS (SELECT 1 FROM invoices WHERE event_id = v.event_id AND id <> v.id
              AND status IN ('open', 'submitted', 'overdue')) THEN
    RETURN invoice_fail('CONFLICT', 'This event has another unpaid invoice. Settle or void it first.');
  END IF;
  v_amt := v.written_off_cents;

  v_evt := invoice_log(v.id, 'reopened', 'admin', p_admin_id, v_amt, p_reason, '{}');
  PERFORM invoice_ledger(v, 'adjustment', 'credit', v_amt, 'unwaive_' || v_evt::TEXT,
                         jsonb_build_object('kind', 'write_off_reversed', 'history_id', v_evt));
  UPDATE invoices
     SET written_off_cents = 0, waived_at = NULL, waived_by = NULL, waive_reason = NULL,
         -- Paid/waived → owed: a fresh status, decided below.
         status = CASE WHEN due_at < now() THEN 'overdue'::invoice_status ELSE 'open'::invoice_status END
   WHERE id = v.id;
  PERFORM invoice_refresh_status(v.id, p_admin_id);
  RETURN invoice_result(v.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Cancels an invoice raised in error. The debt is NOT forgiven: it goes back to
-- "ready to invoice" and can be raised again correctly.
CREATE OR REPLACE FUNCTION invoice_void(p_invoice_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say why the invoice is being voided — the organizer is told.');
  END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status::TEXT NOT IN ('open', 'submitted', 'overdue') THEN
    RETURN invoice_fail('CONFLICT', 'Only an unpaid invoice can be voided.');
  END IF;
  IF v.paid_cents > 0 THEN
    RETURN invoice_fail('CONFLICT', 'Payments are recorded on this invoice. Reverse them first, or waive the rest instead.');
  END IF;

  UPDATE invoices
     SET status = 'void', voided_at = now(), voided_by = p_admin_id, void_reason = btrim(p_reason)
   WHERE id = v.id;
  PERFORM invoice_log(v.id, 'voided', 'admin', p_admin_id, v.amount_cents, p_reason, '{}');
  RETURN invoice_result(v.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 9. Dates and receipts ─────────────────────────────────────────────────
-- An admin's new due date. Clearing the overdue and reminder stamps is what
-- keeps the jobs honest about it: a reminder before the NEW date, and an
-- overdue notice only if the new date passes too.
CREATE OR REPLACE FUNCTION invoice_set_due(p_invoice_id UUID, p_due_at TIMESTAMPTZ, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say why the due date is changing — the organizer is told.');
  END IF;
  IF p_due_at IS NULL OR p_due_at < now() + interval '1 hour' THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'The new due date must be at least an hour from now.');
  END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status::TEXT NOT IN ('open', 'submitted', 'overdue') THEN
    RETURN invoice_fail('CONFLICT', 'Only an unpaid invoice has a due date to change.');
  END IF;

  UPDATE invoices
     SET due_at = p_due_at, overdue_notified_at = NULL, reminder_sent_at = NULL,
         status = CASE WHEN status = 'overdue' THEN 'open'::invoice_status ELSE status END
   WHERE id = v.id;
  PERFORM invoice_log(v.id, 'due_changed', 'admin', p_admin_id, NULL, p_reason,
                      jsonb_build_object('from', v.due_at, 'to', p_due_at));
  PERFORM invoice_refresh_status(v.id, p_admin_id);
  RETURN invoice_result(v.id, jsonb_build_object('previous_due_at', v.due_at));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_submit_receipt(p_invoice_id UUID, p_organizer_id UUID, p_user_id UUID, p_url TEXT)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id AND organizer_id = p_organizer_id FOR UPDATE;
  IF v IS NULL OR v.status::TEXT NOT IN ('open', 'overdue') THEN
    RETURN invoice_fail('CONFLICT', 'That invoice cannot be updated.');
  END IF;
  UPDATE invoices
     SET status = 'submitted', proof_url = p_url, proof_submitted_at = now(),
         receipt_rejected_at = NULL, receipt_rejection_reason = NULL
   WHERE id = v.id;
  PERFORM invoice_log(v.id, 'receipt_submitted', 'organizer', p_user_id, NULL, NULL,
                      jsonb_build_object('url', p_url));
  RETURN invoice_result(v.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The receipt does not show the money. The invoice goes back to unpaid, the
-- receipt link stays in the history, and the organizer is told why.
CREATE OR REPLACE FUNCTION invoice_reject_receipt(p_invoice_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Say what is wrong with the receipt — the organizer is told.');
  END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status <> 'submitted' THEN
    RETURN invoice_fail('CONFLICT', 'There is no receipt waiting on this invoice.');
  END IF;

  UPDATE invoices
     SET status = CASE WHEN due_at < now() THEN 'overdue'::invoice_status ELSE 'open'::invoice_status END,
         receipt_rejected_at = now(), receipt_rejection_reason = btrim(p_reason)
   WHERE id = v.id;
  PERFORM invoice_log(v.id, 'receipt_rejected', 'admin', p_admin_id, NULL, p_reason,
                      jsonb_build_object('url', v.proof_url));
  RETURN invoice_result(v.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_add_note(p_invoice_id UUID, p_note TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF length(btrim(COALESCE(p_note, ''))) < 2 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Write the note.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id) THEN
    RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.');
  END IF;
  PERFORM invoice_log(p_invoice_id, 'note', 'admin', p_admin_id, NULL, p_note, '{}');
  RETURN invoice_result(p_invoice_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 10. The scheduled claims ──────────────────────────────────────────────
-- From 20261114090000, now recording each in the invoice's history.
DROP FUNCTION IF EXISTS claim_overdue_invoices();
CREATE OR REPLACE FUNCTION claim_overdue_invoices()
RETURNS TABLE (invoice_id UUID, invoice_status invoice_status) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE invoices
       SET status = CASE WHEN status = 'open' THEN 'overdue'::invoice_status ELSE status END,
           overdue_notified_at = now()
     WHERE status IN ('open', 'submitted', 'overdue')
       AND due_at < now()
       AND overdue_notified_at IS NULL
    RETURNING id, status
  ), logged AS (
    INSERT INTO invoice_events (invoice_id, kind, actor_role, detail)
    SELECT c.id, 'overdue', 'system', '{}'::jsonb FROM claimed c
  )
  SELECT c.id, c.status FROM claimed c;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

-- Invoices whose due date is within `p_hours`, not yet reminded. Not a receipt
-- waiting for review (the organizer has done their part), and never once due.
CREATE OR REPLACE FUNCTION claim_invoice_reminders(p_hours INT)
RETURNS TABLE (invoice_id UUID) AS $$
BEGIN
  IF COALESCE(p_hours, 0) <= 0 THEN RETURN; END IF;
  RETURN QUERY
  WITH claimed AS (
    UPDATE invoices
       SET reminder_sent_at = now()
     WHERE status = 'open'
       AND reminder_sent_at IS NULL
       AND due_at > now()
       AND due_at <= now() + make_interval(hours => p_hours)
    RETURNING id
  ), logged AS (
    INSERT INTO invoice_events (invoice_id, kind, actor_role, detail)
    SELECT c.id, 'reminder_sent', 'system', jsonb_build_object('hours_before_due', p_hours) FROM claimed c
  )
  SELECT c.id FROM claimed c;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

-- ─── 11. Ready to invoice, on balances ─────────────────────────────────────
-- From 20261114090000: an unpaid invoice covers its BALANCE, not its face
-- amount — a part-paid invoice's payments already reduced the ledger.
CREATE OR REPLACE FUNCTION admin_uninvoiced_commission()
RETURNS TABLE (
  event_id UUID, title TEXT, slug TEXT, starts_at TIMESTAMPTZ, timezone TEXT,
  organizer_id UUID, organizer_name TEXT, currency CHAR(3),
  owed_cents BIGINT, unpaid_invoice_cents BIGINT, uninvoiced_cents BIGINT,
  unpaid_invoice_id UUID, door_sales BIGINT, last_sale_at TIMESTAMPTZ
) AS $$
  WITH owed AS (
    SELECT l.event_id, l.currency,
           SUM(CASE WHEN l.direction = 'credit' THEN l.amount_cents ELSE -l.amount_cents END)::BIGINT AS cents
      FROM ledger_entries l
     WHERE l.channel = 'manual'
     GROUP BY l.event_id, l.currency
  ), unpaid AS (
    SELECT i.event_id, i.currency,
           SUM(i.amount_cents - i.paid_cents - i.written_off_cents)::BIGINT AS cents,
           (array_agg(i.id ORDER BY i.issued_at DESC))[1] AS invoice_id
      FROM invoices i
     WHERE i.status IN ('open', 'submitted', 'overdue')
     GROUP BY i.event_id, i.currency
  ), sales AS (
    SELECT o.event_id, count(*)::BIGINT AS n, max(o.created_at) AS last_at
      FROM orders o
     WHERE o.channel = 'manual'
     GROUP BY o.event_id
  )
  SELECT e.id, e.title, e.slug, e.starts_at, e.timezone,
         org.id, org.display_name, ow.currency,
         ow.cents, COALESCE(u.cents, 0), GREATEST(ow.cents - COALESCE(u.cents, 0), 0),
         u.invoice_id, COALESCE(s.n, 0), s.last_at
    FROM owed ow
    JOIN events e ON e.id = ow.event_id
    JOIN organizers org ON org.id = e.organizer_id
    LEFT JOIN unpaid u ON u.event_id = ow.event_id AND u.currency = ow.currency
    LEFT JOIN sales s ON s.event_id = ow.event_id
   WHERE ow.cents - COALESCE(u.cents, 0) > 0
   ORDER BY e.starts_at, e.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;


-- ─── 12. The gate: an admin's decision, per event ──────────────────────────
--
--   auto    follow the invoices and the platform's enforcement policy (default)
--   open    scanning stays on whatever the invoices say — an exemption
--   closed  scanning is off whatever the invoices say
--
-- `mode_until` makes either one temporary; NULL means until an admin changes
-- it. It expires by being READ (scanner_is_locked compares it with now()), so
-- no job ever touches an admin's decision — the decision carries its own end.
--
-- The old override (`override_until`, open for 12–72 hours) is the special
-- case "open until"; running overrides are carried over and the columns are
-- no longer read.
ALTER TABLE scanner_access
  ADD COLUMN IF NOT EXISTS mode        TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS mode_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mode_reason TEXT,
  ADD COLUMN IF NOT EXISTS mode_set_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS mode_set_at TIMESTAMPTZ;

ALTER TABLE scanner_access DROP CONSTRAINT IF EXISTS scanner_mode_known;
ALTER TABLE scanner_access ADD CONSTRAINT scanner_mode_known CHECK (mode IN ('auto', 'open', 'closed'));

UPDATE scanner_access
   SET mode = 'open', mode_until = override_until, mode_set_by = override_by,
       mode_set_at = COALESCE(updated_at, now()),
       mode_reason = COALESCE(mode_reason, 'Override granted before gate controls existed.')
 WHERE override_until IS NOT NULL AND override_until > now() AND mode = 'auto';

COMMENT ON COLUMN scanner_access.mode IS
  'An admin''s decision about this event''s gate: auto (follow invoices and policy), open, or closed. Read by scanner_is_locked; never changed by a job.';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * IS THIS EVENT'S GATE SHUT, AND WHY — the one answer every door reads:
 * online scans, the door app's dashboard, its offline guest list, the web
 * scanner, the organizer's pages and the admin console.
 *
 * In order — the first that applies decides:
 *
 *   1. a system lock (`is_locked`: the event was cancelled)     locked
 *   2. an admin closed it (and the closure has not expired)      locked
 *   3. an admin opened it                                        open
 *   4. the platform switched invoice enforcement off             open
 *   5. an unpaid invoice is past its due date + grace hours      locked
 *   6. otherwise                                                 open
 *
 * Policy, from the `manual_invoice` platform setting:
 *   enforce_gate      false = invoices never close a gate          (default true)
 *   grace_hours       hours after the due date before they do      (default 0)
 *   pause_on_receipt  a receipt awaiting review holds enforcement  (default false)
 *
 * `override` stays in the answer, true whenever an admin's "open" is what
 * keeps the gate on — the door app and older pages read that key.
 * ─────────────────────────────────────────────────────────────────────────
 */
CREATE OR REPLACE FUNCTION scanner_is_locked(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_row      scanner_access;
  v_cfg      JSONB;
  v_enforce  BOOLEAN;
  v_grace    INT;
  v_pause    BOOLEAN;
  v_mode     TEXT;
  v_active   BOOLEAN;
  v_overdue  INT;
  v_pending  INT;
  v_locks_at TIMESTAMPTZ;
  v_admin    JSONB;
  v_policy   JSONB;
BEGIN
  SELECT * INTO v_row FROM scanner_access WHERE event_id = p_event_id;
  SELECT value INTO v_cfg FROM platform_settings WHERE key = 'manual_invoice';
  v_enforce := COALESCE((v_cfg->>'enforce_gate')::BOOLEAN, true);
  v_grace   := GREATEST(COALESCE((v_cfg->>'grace_hours')::INT, 0), 0);
  v_pause   := COALESCE((v_cfg->>'pause_on_receipt')::BOOLEAN, false);

  v_policy := jsonb_build_object('enforcement', v_enforce, 'grace_hours', v_grace, 'pause_on_receipt', v_pause);

  -- 1. The system's own lock: a cancelled event admits nobody, whatever else.
  IF COALESCE(v_row.is_locked, false) THEN
    RETURN jsonb_build_object('locked', true, 'reason', COALESCE(v_row.locked_reason, 'locked'),
                              'source', 'system', 'override', false, 'mode', 'auto') || v_policy;
  END IF;

  v_mode   := COALESCE(v_row.mode, 'auto');
  -- A running legacy override (written by anything not yet on set_scanner_mode)
  -- is honoured as "open until".
  IF v_mode = 'auto' AND v_row.override_until IS NOT NULL AND v_row.override_until > now() THEN
    v_row.mode := 'open';
    v_row.mode_until := v_row.override_until;
    v_mode := 'open';
  END IF;
  v_active := v_mode <> 'auto' AND (v_row.mode_until IS NULL OR v_row.mode_until > now());
  IF NOT v_active THEN v_mode := 'auto'; END IF;
  v_admin := jsonb_build_object('mode', v_mode,
                                'mode_until', CASE WHEN v_active THEN v_row.mode_until END,
                                'mode_reason', CASE WHEN v_active THEN v_row.mode_reason END,
                                'mode_set_at', CASE WHEN v_active THEN v_row.mode_set_at END);

  -- 2. Closed by an admin.
  IF v_mode = 'closed' THEN
    RETURN jsonb_build_object('locked', true, 'reason', 'admin_closed', 'source', 'admin',
                              'override', false) || v_admin || v_policy;
  END IF;

  -- What the invoices say, whether or not anything below acts on it — the
  -- console shows "open by exemption, 1 invoice overdue".
  SELECT count(*) FILTER (WHERE due_at + make_interval(hours => v_grace) < now()),
         min(due_at + make_interval(hours => v_grace)) FILTER (WHERE due_at + make_interval(hours => v_grace) >= now())
    INTO v_overdue, v_locks_at
    FROM invoices
   WHERE event_id = p_event_id
     AND (status IN ('open', 'overdue') OR (status = 'submitted' AND NOT v_pause));

  SELECT count(*) INTO v_pending FROM invoices
   WHERE event_id = p_event_id AND status = 'submitted' AND due_at + make_interval(hours => v_grace) < now();

  -- 3. Opened by an admin.
  IF v_mode = 'open' THEN
    RETURN jsonb_build_object('locked', false, 'reason', 'admin_open', 'source', 'admin',
                              'override', true, 'overdue_invoices', v_overdue) || v_admin || v_policy;
  END IF;

  -- 4. Enforcement off for the platform.
  IF NOT v_enforce THEN
    RETURN jsonb_build_object('locked', false, 'reason', 'enforcement_off', 'source', 'policy',
                              'override', false, 'overdue_invoices', v_overdue) || v_admin || v_policy;
  END IF;

  -- 5. An unpaid invoice past due (+ grace).
  IF v_overdue > 0 THEN
    RETURN jsonb_build_object('locked', true, 'reason', 'commission_overdue', 'source', 'invoices',
                              'override', false, 'overdue_invoices', v_overdue) || v_admin || v_policy;
  END IF;

  RETURN jsonb_build_object('locked', false, 'override', false, 'source', 'invoices',
                            'overdue_invoices', 0, 'receipts_pending', v_pending,
                            'locks_at', v_locks_at) || v_admin || v_policy;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

/**
 * An admin sets an event's gate. Returns the gate before and after, so the
 * caller can tell the organizer what actually changed.
 */
CREATE OR REPLACE FUNCTION set_scanner_mode(
  p_event_id UUID, p_mode TEXT, p_until TIMESTAMPTZ, p_reason TEXT, p_admin_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_event  RECORD;
  v_before JSONB;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('auto', 'open', 'closed') THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Choose follow invoices, keep open, or keep closed.');
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Record why the gate is changing.');
  END IF;
  IF p_mode <> 'auto' AND p_until IS NOT NULL AND p_until <= now() THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'The end time must be in the future.');
  END IF;

  SELECT id, status INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN RETURN invoice_fail('EVENT_NOT_FOUND', 'That event does not exist.'); END IF;
  IF p_mode = 'open' AND v_event.status = 'cancelled' THEN
    RETURN invoice_fail('CONFLICT', 'This event was cancelled. A cancelled event admits nobody.');
  END IF;

  v_before := scanner_is_locked(p_event_id);

  INSERT INTO scanner_access (event_id, mode, mode_until, mode_reason, mode_set_by, mode_set_at,
                              override_until, override_by, updated_at)
  VALUES (p_event_id, p_mode, CASE WHEN p_mode = 'auto' THEN NULL ELSE p_until END,
          btrim(p_reason), p_admin_id, now(), NULL, NULL, now())
  ON CONFLICT (event_id) DO UPDATE
     SET mode = EXCLUDED.mode, mode_until = EXCLUDED.mode_until, mode_reason = EXCLUDED.mode_reason,
         mode_set_by = EXCLUDED.mode_set_by, mode_set_at = EXCLUDED.mode_set_at,
         override_until = NULL, override_by = NULL, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'before', v_before, 'gate', scanner_is_locked(p_event_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ─── 13. check_in_ticket_v2 ────────────────────────────────────────────────
-- From 20261112090000_seating_pricing_integrity.sql, with one change: an
-- offline admission is recorded even when the gate has since closed.
CREATE OR REPLACE FUNCTION check_in_ticket_v2(
  p_event_id         UUID,
  p_ticket_id        UUID,
  p_qr_version       INT,
  p_device_id        UUID,
  p_client_scan_id   TEXT,
  p_occurred_at      TIMESTAMPTZ DEFAULT NULL,
  p_method           TEXT        DEFAULT 'scan',
  p_offline_admitted BOOLEAN     DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_ticket   RECORD;
  v_event    RECORD;
  v_first    RECORD;
  v_gate     JSONB;
  v_gate_shut BOOLEAN := false;
  v_card     JSONB;
  v_replay   JSONB;
  v_refusal  TEXT;
  v_message  TEXT;
  v_conflict BOOLEAN;
  v_method   TEXT := COALESCE(p_method, 'scan');
  -- The door's clock, within reason. A scan cannot have happened in the future,
  -- and nothing a device holds is older than its 48-hour queue.
  v_when     TIMESTAMPTZ := LEAST(
                GREATEST(COALESCE(p_occurred_at, now()), now() - interval '48 hours'),
                now());
BEGIN
  IF v_method NOT IN ('scan', 'manual', 'offline') THEN
    RAISE EXCEPTION 'unknown check-in method %', v_method USING ERRCODE = '22023';
  END IF;

  -- ── Replay, before anything else ──
  -- A re-uploaded offline scan must get its original answer, not be refused as
  -- a duplicate of itself.
  v_replay := check_in_replay(p_event_id, p_client_scan_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT t.id, t.status, t.scanned_at, t.qr_version, t.transfer_count,
         o.status AS order_status,
         -- Who the door should expect. The ticket's own name when it has one;
         -- otherwise the buyer — except after a transfer, when the buyer is
         -- precisely the person who should NOT be standing there.
         CASE
           WHEN NULLIF(btrim(t.attendee_name), '') IS NOT NULL THEN btrim(t.attendee_name)
           WHEN t.transfer_count > 0 THEN NULL
           ELSE COALESCE(NULLIF(btrim(o.guest_name), ''), NULLIF(btrim(p.full_name), ''))
         END AS holder,
         NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0 AS holder_is_buyer,
         tt.name AS tier_name, tt.kind::TEXT AS tier_kind,
         COALESCE(t.issued_section, s.section_key) AS section_key, COALESCE(t.issued_row, s.row_label) AS row_label, COALESCE(t.issued_seat_number, s.seat_number) AS seat_number, (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END) AS table_label
    INTO v_ticket
    FROM tickets t
    JOIN orders o             ON o.id = t.order_id
    LEFT JOIN profiles p      ON p.id = o.user_id
    LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
    LEFT JOIN seats s         ON s.id = t.seat_id
    LEFT JOIN tables tb       ON tb.id = t.table_id
   WHERE t.id = p_ticket_id
     AND t.event_id = p_event_id
     FOR UPDATE OF t;   -- the lock that makes two doors take turns

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found',
      'message', 'That ticket does not exist.');
  END IF;

  -- ── Replay, again, under the lock ──
  -- Two uploads of the same scan arriving together both miss the first check;
  -- the second one waits on the row lock above and, by the time it gets it,
  -- the first has committed and is visible here.
  v_replay := check_in_replay(p_event_id, p_client_scan_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT id, title, status, starts_at, timezone INTO v_event
    FROM events WHERE id = p_event_id;

  -- What the door shows about the ticket, whatever the answer.
  v_card := jsonb_build_object(
    'ticket_id',       v_ticket.id,
    'attendee',        v_ticket.holder,
    'holder_is_buyer', v_ticket.holder IS NOT NULL AND v_ticket.holder_is_buyer,
    'tier',            v_ticket.tier_name,
    'tier_kind',       v_ticket.tier_kind,
    'seat',            CASE WHEN v_ticket.seat_number IS NOT NULL
                         THEN concat_ws(' ', v_ticket.section_key, concat(v_ticket.row_label, v_ticket.seat_number)) END,
    'table',           v_ticket.table_label,
    'event_title',     v_event.title,
    'event_starts_at', v_event.starts_at,
    'event_timezone',  v_event.timezone,
    'method',          v_method);

  -- A locked gate is the gate's state, not a fact about this ticket: it is not
  -- logged, and it is answered before anything else about the event.
  --
  -- EXCEPT an admission a phone ALREADY made offline (20261115090000). The
  -- person is inside: refusing the upload does not un-admit them, it only
  -- loses the record — the attendance count, the duplicate check at the next
  -- door, the organizer's log. A phone that knew the gate was shut refuses
  -- offline (offlineDecision.ts), so this is only a phone that had not heard.
  -- It is recorded, and marked. A cancelled event still refuses below.
  v_gate := scanner_is_locked(p_event_id);
  v_gate_shut := COALESCE((v_gate->>'locked')::BOOLEAN, false);
  IF v_gate_shut AND NOT (v_method = 'offline' AND COALESCE(p_offline_admitted, false)) THEN
    RETURN jsonb_build_object('ok', false, 'result', 'scanner_locked',
      'reason', v_gate->>'reason',
      'message', 'Scanning is switched off for this event.');
  END IF;

  -- ── Refusals about the ticket or its event ──
  IF v_event.status = 'cancelled' THEN
    v_refusal := 'event_cancelled'; v_message := 'This event was cancelled.';
  ELSIF v_event.status NOT IN ('published', 'archived') THEN
    v_refusal := 'event_not_open'; v_message := 'This event is not open for entry.';
  ELSIF v_ticket.status = 'void' THEN
    v_refusal := 'void'; v_message := 'This ticket is no longer valid.';
  ELSIF v_ticket.order_status <> 'paid' THEN
    v_refusal := 'void'; v_message := 'The order for this ticket was cancelled or refunded.';
  ELSIF COALESCE(p_qr_version, 0) < v_ticket.qr_version THEN
    v_refusal := 'transferred';
    v_message := 'This ticket was transferred to someone else. This code no longer admits.';
  END IF;

  IF v_refusal IS NOT NULL THEN
    -- Logged so the organizer can see what was turned away, but WITHOUT the
    -- scan id: these answers can change (an event reopens, a transfer is
    -- corrected), and a re-upload should be judged again, not replayed.
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, method, detail)
    VALUES (p_ticket_id, p_event_id, p_device_id, v_refusal, v_when, v_method, v_message);
    RETURN jsonb_build_object('ok', false, 'result', v_refusal, 'message', v_message) || v_card;
  END IF;

  -- ── Already in ──
  IF v_ticket.status = 'scanned' THEN
    -- The refusal carries WHEN, and WHERE. "Already used" starts an argument at
    -- the door; "already used at 19:04 at the north door" ends one.
    SELECT sc.occurred_at, d.label AS device_label, pr.full_name AS staff_name
      INTO v_first
      FROM scans sc
      LEFT JOIN scan_devices d ON d.id = sc.device_id
      LEFT JOIN event_staff es ON es.id = d.staff_id
      LEFT JOIN profiles pr    ON pr.id = es.user_id
     WHERE sc.ticket_id = p_ticket_id AND sc.result = 'admitted'
     ORDER BY sc.scanned_at DESC
     LIMIT 1;

    -- A device that ALREADY let this person in while offline, uploading after
    -- another door admitted the same ticket: two people are inside on one
    -- ticket. Nothing to decide at the door any more — flagged for the organizer.
    v_conflict := v_method = 'offline' AND COALESCE(p_offline_admitted, false);

    BEGIN
      INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, method, conflict, detail)
      VALUES (p_ticket_id, p_event_id, p_device_id, 'duplicate', v_when, p_client_scan_id, v_method, v_conflict,
              'already scanned at ' || v_ticket.scanned_at);
    EXCEPTION WHEN unique_violation THEN
      RETURN COALESCE(check_in_replay(p_event_id, p_client_scan_id),
        jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.'));
    END;

    RETURN jsonb_build_object(
      'ok', false, 'result', 'duplicate',
      'scanned_at', v_ticket.scanned_at,
      'conflict', v_conflict,
      'first_scan', jsonb_build_object(
        'at', COALESCE(v_first.occurred_at, v_ticket.scanned_at),
        'device', v_first.device_label,
        'staff', v_first.staff_name),
      'message', 'Already scanned at '
        || to_char(v_ticket.scanned_at AT TIME ZONE COALESCE(v_event.timezone, 'UTC'), 'HH24:MI')
    ) || v_card;
  END IF;

  -- ── Admit ──
  BEGIN
    UPDATE tickets SET status = 'scanned', scanned_at = v_when WHERE id = p_ticket_id;
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, method, detail)
    VALUES (p_ticket_id, p_event_id, p_device_id, 'admitted', v_when, p_client_scan_id, v_method,
            CASE WHEN v_gate_shut THEN 'admitted offline while scanning was switched off ('
                                     || COALESCE(v_gate->>'reason', 'locked') || ')' END);
  EXCEPTION WHEN unique_violation THEN
    -- The same scan id on a different ticket. Rolled back to the savepoint, so
    -- the ticket above is untouched.
    RETURN COALESCE(check_in_replay(p_event_id, p_client_scan_id),
      jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.'));
  END;

  RETURN jsonb_build_object('ok', true, 'result', 'admitted', 'scanned_at', v_when) || v_card;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 14. platform_overview ─────────────────────────────────────────────────
-- From 20260915140000, with one change: open and overdue receivables are the
-- invoices' BALANCES. A part-paid invoice counted at its face amount made
-- "uninvoiced" (owed less open) read low by whatever had been paid.
CREATE OR REPLACE FUNCTION platform_overview(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH win AS (SELECT LEAST(GREATEST(p_days, 1), 366) AS n),
  paid AS (SELECT * FROM orders WHERE status = 'paid'),
  days AS (
    SELECT generate_series(current_date - ((SELECT n FROM win) - 1), current_date, interval '1 day')::date AS d
  ),
  daily AS (
    SELECT day, jsonb_object_agg(currency, jsonb_build_object(
             'orders', orders, 'tickets', tickets, 'grossCents', gross, 'commissionCents', commission)) AS by_currency
      FROM (
        SELECT (paid_at AT TIME ZONE 'UTC')::date AS day, currency, count(*) AS orders,
               sum(quantity) AS tickets, sum(buyer_total_cents) AS gross,
               sum(commission_cents + commission_tax_cents) AS commission
          FROM paid
         WHERE paid_at >= now() - make_interval(days => (SELECT n FROM win))
         GROUP BY 1, 2
      ) g
     GROUP BY day
  ),
  -- CHANGED: what Eventsli keeps includes the commission on door sales. A card
  -- order records it in platform_net_cents; a door sale has none recorded, and
  -- was left out entirely.
  money AS (
    SELECT currency, paid_at, quantity, buyer_total_cents, channel,
           commission_cents + commission_tax_cents AS commission,
           CASE WHEN channel = 'manual' AND platform_net_cents IS NULL
                THEN commission_cents + commission_tax_cents
                ELSE COALESCE(platform_net_cents, 0) END AS platform_net
      FROM paid
  )
  SELECT jsonb_build_object(
    'people', (
      SELECT jsonb_build_object(
               'total', count(*),
               'blocked', count(*) FILTER (WHERE is_blocked),
               'staff', count(*) FILTER (WHERE role IN ('admin', 'super_admin')),
               'newInWindow', count(*) FILTER (WHERE created_at >= now() - make_interval(days => (SELECT n FROM win))))
        FROM profiles
    ),
    'organizers', (
      SELECT jsonb_build_object(
               'total', count(*),
               'banned', count(*) FILTER (WHERE is_banned),
               'payoutReady', count(*) FILTER (WHERE stripe_onboarding_complete AND stripe_payouts_enabled))
        FROM organizers
    ),
    'events', (
      SELECT jsonb_build_object(
               'total', count(*),
               'draft', count(*) FILTER (WHERE status = 'draft'),
               'pendingReview', count(*) FILTER (WHERE status = 'pending_review'),
               'rejected', count(*) FILTER (WHERE status = 'rejected'),
               'published', count(*) FILTER (WHERE status = 'published'),
               'suspended', count(*) FILTER (WHERE status = 'suspended'),
               'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
               'completed', count(*) FILTER (WHERE status = 'completed'))
        FROM events
    ),
    -- All time, as before.
    'sales', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'commissionCents', commission, 'platformNetCents', platform_net,
               'stripeOrders', stripe_orders, 'manualOrders', manual_orders))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross, sum(commission) AS commission,
                 sum(platform_net) AS platform_net,
                 count(*) FILTER (WHERE channel = 'stripe') AS stripe_orders,
                 count(*) FILTER (WHERE channel = 'manual') AS manual_orders
            FROM money GROUP BY currency
        ) s
    ), '{}'::jsonb),
    -- CHANGED (M15): the same figures for the chosen period, so the 7/30/90
    -- switch beside the money cards actually changes them.
    'salesInWindow', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'commissionCents', commission, 'platformNetCents', platform_net))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross, sum(commission) AS commission,
                 sum(platform_net) AS platform_net
            FROM money
           WHERE paid_at >= now() - make_interval(days => (SELECT n FROM win))
           GROUP BY currency
        ) s
    ), '{}'::jsonb),
    -- BRD §20 — what organizers owe Eventsli on the manual channel.
    -- CHANGED: `uninvoicedCents` is commission accrued on door sales that no
    -- invoice covers yet — the manual ledger's balance less what open invoices
    -- already ask for. It was invisible until an invoice was raised.
    'receivables', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'openCents', open_cents, 'overdueCents', overdue_cents, 'overdueCount', overdue_count,
               'uninvoicedCents', GREATEST(owed_cents - open_cents, 0)))
        FROM (
          SELECT cur.currency,
                 COALESCE(inv.open_cents, 0) AS open_cents,
                 COALESCE(inv.overdue_cents, 0) AS overdue_cents,
                 COALESCE(inv.overdue_count, 0) AS overdue_count,
                 COALESCE(led.owed_cents, 0) AS owed_cents
            FROM (SELECT currency FROM invoices
                  UNION SELECT currency FROM ledger_entries WHERE channel = 'manual') cur
            LEFT JOIN (
              SELECT currency,
                     COALESCE(sum(amount_cents - paid_cents - written_off_cents) FILTER (WHERE status IN ('open', 'submitted', 'overdue')), 0) AS open_cents,
                     COALESCE(sum(amount_cents - paid_cents - written_off_cents) FILTER (WHERE status = 'overdue'
                       OR (status IN ('open', 'submitted') AND due_at < now())), 0) AS overdue_cents,
                     count(*) FILTER (WHERE status = 'overdue'
                       OR (status IN ('open', 'submitted') AND due_at < now())) AS overdue_count
                FROM invoices GROUP BY currency
            ) inv ON inv.currency = cur.currency
            LEFT JOIN (
              SELECT currency,
                     sum(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END) AS owed_cents
                FROM ledger_entries WHERE channel = 'manual' GROUP BY currency
            ) led ON led.currency = cur.currency
        ) r
    ), '{}'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', days.d, 'byCurrency', COALESCE(daily.by_currency, '{}'::jsonb))
             ORDER BY days.d)
        FROM days LEFT JOIN daily ON daily.day = days.d
    ), '[]'::jsonb),
    'topEvents', COALESCE((
      SELECT jsonb_agg(q.j ORDER BY q.k DESC)
        FROM (
          SELECT sum(o.buyer_total_cents) AS k, jsonb_build_object(
                   'id', e.id, 'title', e.title, 'organizer', org.display_name,
                   'currency', o.currency, 'grossCents', sum(o.buyer_total_cents),
                   'tickets', sum(o.quantity)) AS j
            FROM paid o
            JOIN events e ON e.id = o.event_id
            JOIN organizers org ON org.id = e.organizer_id
           WHERE o.paid_at >= now() - make_interval(days => (SELECT n FROM win))
           GROUP BY e.id, e.title, org.display_name, o.currency
           ORDER BY sum(o.buyer_total_cents) DESC
           LIMIT 5
        ) q
    ), '[]'::jsonb)
  );
$$;


-- ─── 15. Access ────────────────────────────────────────────────────────────
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_events   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_payments FROM anon, authenticated;
REVOKE ALL ON invoice_events   FROM anon, authenticated;
GRANT ALL ON invoice_payments TO service_role;
GRANT ALL ON invoice_events   TO service_role;

REVOKE ALL ON FUNCTION invoice_payments_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_invoice_due_original() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION invoice_events_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'invoice_ledger(invoices, ledger_type, ledger_direction, BIGINT, TEXT, JSONB)',
    'invoice_log(UUID, TEXT, TEXT, UUID, BIGINT, TEXT, JSONB)',
    'invoice_refresh_status(UUID, UUID)',
    'invoice_result(UUID, JSONB)',
    'invoice_fail(TEXT, TEXT)',
    'raise_commission_invoice(UUID, UUID)',
    'invoice_record_payment(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID)',
    'settle_invoice(UUID, UUID, TEXT)',
    'invoice_reverse_payment(UUID, TEXT, UUID)',
    'invoice_waive(UUID, TEXT, UUID)',
    'invoice_reopen(UUID, TEXT, UUID)',
    'invoice_void(UUID, TEXT, UUID)',
    'invoice_set_due(UUID, TIMESTAMPTZ, TEXT, UUID)',
    'invoice_submit_receipt(UUID, UUID, UUID, TEXT)',
    'invoice_reject_receipt(UUID, TEXT, UUID)',
    'invoice_add_note(UUID, TEXT, UUID)',
    'claim_overdue_invoices()',
    'claim_invoice_reminders(INT)',
    'admin_uninvoiced_commission()',
    'scanner_is_locked(UUID)',
    'set_scanner_mode(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
