-- ═══════════════════════════════════════════════════════════════════════════
-- Credit notes, and no invoice without complete legal and tax details
-- (owner request 2026-11-17: "invoices never charge organizers for amounts that
-- are no longer owed" / "complete, accurate, and validated before generating
-- any invoice").
--
-- WHAT WAS WRONG
--
--   1. A sale on an UNPAID invoice that was then voided or refunded
--      (order_void_offline) reversed the commission in the ledger, but the
--      invoice still asked for the full amount. The organizer was charged for
--      commission they no longer owed, and an admin recording what they paid
--      would have hit "more than the balance" only after the fact.
--   2. Same sale on a PAID invoice: the ledger went negative — a credit — but
--      nothing told the organizer, and if a second invoice was already open it
--      kept asking for its full amount while the credit sat unused.
--   3. Same sale on a WAIVED invoice: the reversal turned commission Eventsli
--      had already forgiven into a "credit" — money the organizer never paid.
--   4. A payment reversed (a bounced transfer) on an invoice that had absorbed
--      a credit: the invoice went back to asking for its full amount.
--   5. An invoice could be raised with Eventsli's legal name, address and tax
--      number blank, and with no billing address for the organizer — a
--      document that is not a valid invoice in most countries.
--
-- WHAT THIS DOES
--
--   · CREDIT NOTES. Voiding or refunding a paid manual sale that an invoice
--     already covers issues a numbered credit note (CN-…) for the commission
--     and tax on it, frozen with the same issuer/recipient as the invoice. It
--     is spent, in this order:
--       a. against what is still unpaid on that invoice ("applied");
--       b. against any part of it that was waived — the waiver shrinks rather
--          than becoming a credit (fixes 3);
--       c. against the event's other unpaid invoice, if one is open;
--       d. whatever is left is a CREDIT BALANCE: netted off the next invoice
--          automatically, or refunded to the organizer by an admin
--          (credit_note_refund), never both.
--     A sale no invoice covers yet needs no credit note: the next invoice
--     simply does not include it.
--   · invoices.credited_cents: what credit notes took off. Every balance is
--     now amount − paid − waived − credited. A new status, 'credited', for an
--     invoice credit notes cleared with nothing paid or waived.
--   · Voiding an invoice releases the credit applied to it (it becomes credit
--     balance again, so nothing is lost). Reversing a payment or reopening a
--     waived invoice re-applies any credit balance first (fixes 4).
--   · BILLING DETAILS. organizers.billing_address, tax_status ('registered' /
--     'not_registered') and tax_id (required when registered).
--     raise_commission_invoice refuses with BILLING_DETAILS_INCOMPLETE — and
--     lists what is missing — unless Eventsli's legal name, address, tax number
--     and a valid billing email are set, and the organizer has a legal name,
--     billing address, country, tax status (and number), and an owner email.
--     The organizer's billing address and tax details are frozen on the
--     invoice with the rest.
--
-- Amounts already on issued invoices are NOT changed: an invoice is a record
-- of what was asked. Credit notes are the record of what was taken off.
--
-- Needs 20261123100000 (invoice_document). Local only until approved.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'credited';

-- ─── 1. Invoice money ──────────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credited_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoice_money_bounds;
ALTER TABLE invoices ADD CONSTRAINT invoice_money_bounds
  CHECK (paid_cents >= 0 AND written_off_cents >= 0 AND credited_cents >= 0
         AND paid_cents + written_off_cents + credited_cents <= amount_cents);

ALTER TABLE invoice_events DROP CONSTRAINT IF EXISTS invoice_events_kind_check;
ALTER TABLE invoice_events ADD CONSTRAINT invoice_events_kind_check CHECK (kind IN (
  'raised', 'reminder_sent', 'overdue', 'receipt_submitted', 'receipt_rejected',
  'due_changed', 'payment_recorded', 'payment_reversed', 'settled',
  'waived', 'reopened', 'voided', 'note',
  'credited', 'credit_released'));

-- ─── 2. Organizer billing details ──────────────────────────────────────────
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS tax_status TEXT;
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS tax_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizer_billing_details_shape') THEN
    ALTER TABLE organizers ADD CONSTRAINT organizer_billing_details_shape CHECK (
      (billing_address IS NULL OR char_length(billing_address) <= 500)
      AND (tax_status IS NULL OR tax_status IN ('registered', 'not_registered'))
      AND (tax_id IS NULL OR char_length(tax_id) BETWEEN 3 AND 40)
      -- Registered for tax means a number on the invoice; not registered means none.
      AND (tax_status IS DISTINCT FROM 'registered' OR tax_id IS NOT NULL)
      AND (tax_status IS DISTINCT FROM 'not_registered' OR tax_id IS NULL)
    );
  END IF;
END $$;

-- ─── 3. Credit notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                TEXT NOT NULL UNIQUE,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id          UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  -- The invoice that covered the sale. The credit note corrects it.
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- One credit note per sale: a second void of the same order is a no-op.
  order_id              UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  currency              CHAR(3) NOT NULL,
  commission_cents      BIGINT NOT NULL CHECK (commission_cents >= 0),
  commission_tax_cents  BIGINT NOT NULL CHECK (commission_tax_cents >= 0),
  amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
  -- Not yet applied, netted or refunded. The only column that ever changes.
  remaining_cents       BIGINT NOT NULL CHECK (remaining_cents >= 0),
  kind                  TEXT NOT NULL CHECK (kind IN ('void', 'refund')),
  reason                TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  issuer                JSONB NOT NULL DEFAULT '{}',
  recipient             JSONB NOT NULL DEFAULT '{}',
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_adds_up CHECK (commission_cents + commission_tax_cents = amount_cents),
  CONSTRAINT credit_note_remaining_bounds CHECK (remaining_cents <= amount_cents)
);
CREATE INDEX IF NOT EXISTS credit_notes_event_idx ON credit_notes (event_id, currency, created_at);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx ON credit_notes (invoice_id);

/**
 * Where each credit note's money went. Append-only; a release is its own row.
 *   applied   taken off an unpaid (or waived) invoice — invoice_id says which
 *   released  given back because that invoice was voided
 *   netted    absorbed by the next invoice raised for the event
 *   refunded  paid back to the organizer by an admin (method + reference)
 */
CREATE TABLE IF NOT EXISTS credit_note_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id  UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('applied', 'released', 'netted', 'refunded')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  -- The part of an 'applied' row that shrank a waiver instead of a balance.
  from_write_off  BOOLEAN NOT NULL DEFAULT false,
  method          TEXT CHECK (method IS NULL OR char_length(method) <= 60),
  reference       TEXT CHECK (reference IS NULL OR char_length(reference) <= 120),
  note            TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  actor_id        UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_allocation_invoice CHECK ((kind = 'refunded') = (invoice_id IS NULL))
);
CREATE INDEX IF NOT EXISTS credit_note_allocations_note_idx ON credit_note_allocations (credit_note_id, created_at);
CREATE INDEX IF NOT EXISTS credit_note_allocations_invoice_idx ON credit_note_allocations (invoice_id);

CREATE OR REPLACE FUNCTION credit_note_allocations_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'credit note history is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_credit_note_allocations_guard ON credit_note_allocations;
CREATE TRIGGER trg_credit_note_allocations_guard
  BEFORE UPDATE OR DELETE ON credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION credit_note_allocations_guard();

-- A credit note is a document: only what is left of it moves.
CREATE OR REPLACE FUNCTION credit_notes_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'a credit note cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'remaining_cents' - 'order_id') IS DISTINCT FROM (to_jsonb(OLD) - 'remaining_cents' - 'order_id')
     OR (NEW.order_id IS DISTINCT FROM OLD.order_id AND NEW.order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a credit note cannot be edited once issued';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_credit_notes_guard ON credit_notes;
CREATE TRIGGER trg_credit_notes_guard
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION credit_notes_guard();

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON credit_notes FROM anon, authenticated;
REVOKE ALL ON credit_note_allocations FROM anon, authenticated;
GRANT ALL ON credit_notes TO service_role;
GRANT ALL ON credit_note_allocations TO service_role;

-- ─── 4. Billing details check ──────────────────────────────────────────────
/**
 * What is missing before an invoice may be issued to this organizer.
 * {ok, issuer_missing: [...], organizer_missing: [...]} — field names, so the
 * admin and the organizer can be told exactly what to fill in.
 */
/** Eventsli's half, on its own so it can be checked against any value. Pure. */
CREATE OR REPLACE FUNCTION invoice_issuer_missing(p_issuer JSONB)
RETURNS TEXT[] AS $$
DECLARE
  v_iss   JSONB := COALESCE(p_issuer, '{}'::jsonb);
  v_imiss TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF char_length(btrim(COALESCE(v_iss->>'legal_name', ''))) < 2 THEN v_imiss := array_append(v_imiss, 'legal_name'); END IF;
  IF char_length(btrim(COALESCE(v_iss->>'address', ''))) < 10 THEN v_imiss := array_append(v_imiss, 'address'); END IF;
  IF char_length(btrim(COALESCE(v_iss->>'tax_id', ''))) < 3 THEN v_imiss := array_append(v_imiss, 'tax_id'); END IF;
  IF COALESCE(v_iss->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN v_imiss := array_append(v_imiss, 'email'); END IF;
  RETURN v_imiss;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_billing_check(p_organizer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_iss  JSONB;
  v_org  RECORD;
  v_imiss TEXT[];
  v_omiss TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT value INTO v_iss FROM platform_settings WHERE key = 'invoice_issuer';
  v_imiss := invoice_issuer_missing(v_iss);

  SELECT o.legal_name, o.billing_address, o.country, o.tax_status, o.tax_id, p.email
    INTO v_org
    FROM organizers o LEFT JOIN profiles p ON p.id = o.owner_user_id
   WHERE o.id = p_organizer_id;
  IF NOT FOUND THEN
    v_omiss := ARRAY['organizer'];
  ELSE
    IF char_length(btrim(COALESCE(v_org.legal_name, ''))) < 2 THEN v_omiss := array_append(v_omiss, 'legal_name'); END IF;
    IF char_length(btrim(COALESCE(v_org.billing_address, ''))) < 10 THEN v_omiss := array_append(v_omiss, 'billing_address'); END IF;
    IF COALESCE(v_org.country, '') !~ '^[A-Z]{2}$' THEN v_omiss := array_append(v_omiss, 'country'); END IF;
    IF v_org.tax_status IS NULL THEN v_omiss := array_append(v_omiss, 'tax_status');
    ELSIF v_org.tax_status = 'registered' AND char_length(btrim(COALESCE(v_org.tax_id, ''))) < 3 THEN
      v_omiss := array_append(v_omiss, 'tax_id');
    END IF;
    IF COALESCE(v_org.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN v_omiss := array_append(v_omiss, 'email'); END IF;
  END IF;

  RETURN jsonb_build_object('ok', cardinality(v_imiss) = 0 AND cardinality(v_omiss) = 0,
                            'issuer_missing', to_jsonb(v_imiss), 'organizer_missing', to_jsonb(v_omiss));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ─── 5. Status and result ──────────────────────────────────────────────────
/**
 * The one place a status is derived:
 *   void                       stays void
 *   nothing left to pay        'waived' if part was forgiven, else 'paid' if
 *                              anything was paid, else 'credited'
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

  IF v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents <= 0 THEN
    v_s := CASE WHEN v.written_off_cents > 0 THEN 'waived'::invoice_status
                WHEN v.paid_cents > 0 THEN 'paid'::invoice_status
                ELSE 'credited'::invoice_status END;
  ELSIF v.status::TEXT = 'submitted' THEN
    v_s := 'submitted';
  ELSIF v.due_at < now() THEN
    v_s := 'overdue';
  ELSE
    v_s := 'open';
  END IF;

  UPDATE invoices
     SET status = v_s,
         confirmed_at = CASE WHEN v_s::TEXT = 'paid' THEN COALESCE(confirmed_at, now()) ELSE NULL END,
         confirmed_by = CASE WHEN v_s::TEXT = 'paid' THEN COALESCE(p_admin_id, confirmed_by) ELSE NULL END
   WHERE id = p_invoice_id;
  RETURN v_s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION invoice_result(p_invoice_id UUID, p_extra JSONB DEFAULT '{}')
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
           'ok', true, 'invoice_id', i.id, 'number', i.number, 'status', i.status,
           'amount_cents', i.amount_cents, 'paid_cents', i.paid_cents,
           'written_off_cents', i.written_off_cents,
           'credited_cents', i.credited_cents,
           'balance_cents', CASE WHEN i.status::TEXT = 'void' THEN 0
                                 ELSE i.amount_cents - i.paid_cents - i.written_off_cents - i.credited_cents END,
           'due_at', i.due_at,
           'remaining_owed_cents', manual_commission_owed(i.event_id, i.currency)
         ) || COALESCE(p_extra, '{}')
    FROM invoices i WHERE i.id = p_invoice_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── 6. Spending credit ────────────────────────────────────────────────────
/** One allocation row, and the credit note's remaining amount, together. */
CREATE OR REPLACE FUNCTION credit_note_allocate(
  p_note_id UUID, p_invoice_id UUID, p_kind TEXT, p_amount BIGINT, p_actor UUID,
  p_from_write_off BOOLEAN DEFAULT false, p_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  INSERT INTO credit_note_allocations (credit_note_id, invoice_id, kind, amount_cents, from_write_off,
                                       method, reference, note, actor_id)
  VALUES (p_note_id, p_invoice_id, p_kind, p_amount, p_from_write_off,
          NULLIF(btrim(p_method), ''), NULLIF(btrim(p_reference), ''), NULLIF(btrim(p_note), ''), p_actor)
  RETURNING id INTO v_id;
  UPDATE credit_notes
     SET remaining_cents = remaining_cents + CASE WHEN p_kind = 'released' THEN p_amount ELSE -p_amount END
   WHERE id = p_note_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Any credit balance on this event goes onto its unpaid invoice, oldest credit
 * first, up to what the invoice still asks for. Called whenever credit appears
 * or an invoice starts asking for money again. Returns what was applied.
 */
CREATE OR REPLACE FUNCTION credit_apply_to_unpaid(p_event_id UUID, p_currency CHAR(3), p_actor UUID DEFAULT NULL,
                                                  p_role TEXT DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
  v       invoices;
  n       RECORD;
  v_bal   BIGINT;
  v_amt   BIGINT;
  v_total BIGINT := 0;
BEGIN
  SELECT * INTO v FROM invoices
   WHERE event_id = p_event_id AND currency = p_currency AND status IN ('open', 'submitted', 'overdue')
   ORDER BY issued_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents;

  FOR n IN SELECT id, number, remaining_cents FROM credit_notes
            WHERE event_id = p_event_id AND currency = p_currency AND remaining_cents > 0
            ORDER BY created_at, id FOR UPDATE LOOP
    EXIT WHEN v_bal <= 0;
    v_amt := LEAST(n.remaining_cents, v_bal);
    PERFORM credit_note_allocate(n.id, v.id, 'applied', v_amt, p_actor);
    UPDATE invoices SET credited_cents = credited_cents + v_amt WHERE id = v.id;
    PERFORM invoice_log(v.id, 'credited', COALESCE(p_role, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'admin' END), p_actor, v_amt,
                        NULL, jsonb_build_object('credit_note_id', n.id, 'credit_note_number', n.number,
                                                 'carried_credit', true));
    v_bal := v_bal - v_amt;
    v_total := v_total + v_amt;
  END LOOP;

  IF v_total > 0 THEN PERFORM invoice_refresh_status(v.id, p_actor); END IF;
  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * A covered sale was voided or refunded: the credit note, and where its money
 * goes (see the header). Called from order_void_offline after the commission
 * reversal is in the ledger. Returns {credit_note_id, number, applied_cents,
 * carried_cents} or NULL when no invoice covers the sale.
 */
CREATE OR REPLACE FUNCTION credit_note_issue_for_order(o orders, p_actor UUID, p_role TEXT, p_kind TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v        invoices;
  v_amt    BIGINT := COALESCE(o.commission_cents, 0) + COALESCE(o.commission_tax_cents, 0);
  v_bal    BIGINT;
  v_a1     BIGINT;
  v_a2     BIGINT;
  v_seq    INT;
  v_id     UUID := gen_random_uuid();
  v_number TEXT;
  v_issuer JSONB;
  v_other  BIGINT;
  -- invoice_events knows three actors; the door team and staff act for the organizer.
  v_role   TEXT := CASE WHEN p_actor IS NULL THEN 'system'
                        WHEN p_role IN ('admin', 'super_admin') THEN 'admin' ELSE 'organizer' END;
BEGIN
  IF v_amt <= 0 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM credit_notes WHERE order_id = o.id) THEN RETURN NULL; END IF;

  -- The invoice whose period took this sale in (the same window
  -- raise_commission_invoice uses: after covers_from, up to covers_to).
  SELECT * INTO v FROM invoices
   WHERE event_id = o.event_id AND currency = o.currency AND status::TEXT <> 'void'
     AND covers_to IS NOT NULL AND o.created_at <= covers_to
     AND (covers_from IS NULL OR o.created_at > covers_from)
   ORDER BY issued_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) + 1 INTO v_seq FROM credit_notes WHERE event_id = o.event_id;
  v_number := 'CN-' || to_char(now(), 'YYYYMMDD') || '-' || substr(o.event_id::TEXT, 1, 8) || '-' || v_seq;
  SELECT COALESCE(value, '{}'::jsonb) INTO v_issuer FROM platform_settings WHERE key = 'invoice_issuer';

  INSERT INTO credit_notes (id, number, event_id, organizer_id, invoice_id, order_id, currency,
                            commission_cents, commission_tax_cents, amount_cents, remaining_cents,
                            kind, reason, issuer, recipient, created_by)
  VALUES (v_id, v_number, o.event_id, o.organizer_id, v.id, o.id, o.currency,
          COALESCE(o.commission_cents, 0), COALESCE(o.commission_tax_cents, 0), v_amt, v_amt,
          p_kind, btrim(p_reason),
          COALESCE(NULLIF(v.issuer, '{}'::jsonb), v_issuer, '{}'::jsonb),
          COALESCE(v.recipient, jsonb_build_object('organizer_id', o.organizer_id)),
          p_actor);

  -- a. What is still unpaid on the invoice.
  v_bal := GREATEST(v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents, 0);
  v_a1 := LEAST(v_amt, v_bal);
  -- b. What was waived on it: the waiver shrinks. Its ledger debit is undone
  --    by as much, so the reversal does not become a credit for money never paid.
  v_a2 := LEAST(v_amt - v_a1, v.written_off_cents);

  PERFORM credit_note_allocate(v_id, v.id, 'applied', v_a1, p_actor);
  IF v_a2 > 0 THEN
    PERFORM credit_note_allocate(v_id, v.id, 'applied', v_a2, p_actor, true);
    PERFORM invoice_ledger(v, 'adjustment', 'credit', v_a2, 'cn_unwaive_' || v_id::TEXT,
                           jsonb_build_object('kind', 'write_off_reduced_by_credit_note', 'credit_note_id', v_id));
  END IF;
  UPDATE invoices
     SET credited_cents = credited_cents + v_a1 + v_a2,
         written_off_cents = written_off_cents - v_a2
   WHERE id = v.id;

  PERFORM invoice_log(v.id, 'credited', v_role, p_actor,
                      v_amt, btrim(p_reason),
                      jsonb_build_object('credit_note_id', v_id, 'credit_note_number', v_number, 'order_id', o.id,
                                         'kind', p_kind, 'applied_cents', v_a1, 'waiver_reduced_cents', v_a2,
                                         'carried_cents', v_amt - v_a1 - v_a2));
  PERFORM invoice_refresh_status(v.id, NULL);

  -- c. The event's other unpaid invoice, if any.
  v_other := 0;
  IF v_amt - v_a1 - v_a2 > 0 THEN
    v_other := credit_apply_to_unpaid(o.event_id, o.currency, p_actor, v_role);
  END IF;

  RETURN jsonb_build_object('credit_note_id', v_id, 'number', v_number, 'invoice_id', v.id,
                            'amount_cents', v_amt, 'applied_cents', v_a1 + v_a2 + v_other,
                            'carried_cents', v_amt - v_a1 - v_a2 - v_other);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * d. A credit balance paid back to the organizer. Only what the credit note
 * still holds, and only while the event's manual ledger really is in the
 * organizer's favour by at least that much — so a credit can never be both
 * netted and refunded.
 */
CREATE OR REPLACE FUNCTION credit_note_refund(
  p_credit_note_id UUID, p_amount_cents BIGINT, p_method TEXT, p_reference TEXT, p_note TEXT, p_admin_id UUID
) RETURNS JSONB AS $$
DECLARE
  n       credit_notes;
  v_owed  BIGINT;
  v_alloc UUID;
BEGIN
  SELECT * INTO n FROM credit_notes WHERE id = p_credit_note_id FOR UPDATE;
  IF n IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That credit note does not exist.'); END IF;
  -- The event row serialises this against raising an invoice for it.
  PERFORM 1 FROM events WHERE id = n.event_id FOR UPDATE;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Enter the amount paid back.');
  END IF;
  IF p_amount_cents > n.remaining_cents THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'That is more than is left on this credit note.');
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE event_id = n.event_id AND currency = n.currency
              AND status IN ('open', 'submitted', 'overdue')) THEN
    RETURN invoice_fail('CONFLICT', 'This event has an unpaid invoice. The credit goes against it first.');
  END IF;
  v_owed := manual_commission_owed(n.event_id, n.currency);
  IF -v_owed < p_amount_cents THEN
    RETURN invoice_fail('CONFLICT', 'The organizer''s account does not hold that much credit any more.');
  END IF;
  IF length(btrim(COALESCE(p_reference, ''))) < 2 THEN
    RETURN invoice_fail('VALIDATION_ERROR', 'Enter the reference of the payment back to the organizer.');
  END IF;

  v_alloc := credit_note_allocate(n.id, NULL, 'refunded', p_amount_cents, p_admin_id, false,
                                  COALESCE(NULLIF(btrim(p_method), ''), 'bank transfer'), p_reference, p_note);
  -- Money out to the organizer: the ledger moves back toward zero.
  PERFORM ledger_write(n.event_id, n.organizer_id, NULL, 'manual', 'settlement', 'credit',
                       p_amount_cents, n.currency, 'cn_refund_' || v_alloc::TEXT);
  RETURN jsonb_build_object('ok', true, 'credit_note_id', n.id, 'number', n.number,
                            'refunded_cents', p_amount_cents, 'remaining_cents', n.remaining_cents - p_amount_cents,
                            'allocation_id', v_alloc);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 7. The invoice actions, with credit in the balance ────────────────────
CREATE OR REPLACE FUNCTION invoice_record_payment(
  p_invoice_id UUID, p_amount_cents BIGINT, p_method TEXT, p_reference TEXT,
  p_received_at TIMESTAMPTZ, p_note TEXT, p_admin_id UUID, p_idempotency_key UUID DEFAULT NULL
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

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_prior FROM invoice_payments
     WHERE invoice_id = v.id AND idempotency_key = p_idempotency_key;
    IF v_prior IS NOT NULL THEN
      RETURN invoice_result(v.id, jsonb_build_object('payment_id', v_prior, 'duplicate', true,
                                                     'settled', v.status::TEXT = 'paid'));
    END IF;
  END IF;

  IF v.status::TEXT IN ('void', 'waived', 'paid', 'credited') THEN
    RETURN invoice_fail('CONFLICT', 'This invoice is ' || v.status::TEXT || ' — there is nothing to pay on it.');
  END IF;

  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents;
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
  IF v_status::TEXT = 'paid' THEN
    PERFORM invoice_log(v.id, 'settled', 'admin', p_admin_id, v.amount_cents, NULL, '{}');
  END IF;

  RETURN invoice_result(v.id, jsonb_build_object('payment_id', v_pay, 'settled', v_status::TEXT = 'paid'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION settle_invoice(p_invoice_id UUID, p_admin_id UUID, p_note TEXT)
RETURNS JSONB AS $$
DECLARE v invoices;
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF v IS NULL THEN RETURN invoice_fail('NOT_FOUND', 'That invoice does not exist.'); END IF;
  IF v.status::TEXT IN ('paid', 'credited') THEN
    RETURN invoice_result(v.id, jsonb_build_object('already_settled', true));
  END IF;
  RETURN invoice_record_payment(p_invoice_id, v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents,
                                'bank transfer', NULL, now(), p_note, p_admin_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
  v_bal := v.amount_cents - v.paid_cents - v.written_off_cents - v.credited_cents;

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
         status = CASE WHEN due_at < now() THEN 'overdue'::invoice_status ELSE 'open'::invoice_status END
   WHERE id = v.id;
  PERFORM invoice_refresh_status(v.id, p_admin_id);
  -- Owed again: a credit balance the organizer holds comes off it first.
  PERFORM credit_apply_to_unpaid(v.event_id, v.currency, p_admin_id);
  RETURN invoice_result(v.id);
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
  -- Owed again: a credit balance the organizer holds comes off it first.
  PERFORM credit_apply_to_unpaid(v.event_id, v.currency, p_admin_id);
  RETURN invoice_result(v.id, jsonb_build_object('payment_id', p.id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Voided: the invoice asked for nothing. Credit applied to it is released back
 * to its credit notes — the commission reversal is still in the ledger, so the
 * next invoice reflects it either way, and nothing is counted twice.
 */
CREATE OR REPLACE FUNCTION invoice_void(p_invoice_id UUID, p_reason TEXT, p_admin_id UUID)
RETURNS JSONB AS $$
DECLARE
  v invoices;
  a RECORD;
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

  FOR a IN SELECT credit_note_id,
                  SUM(CASE WHEN kind = 'released' THEN -amount_cents ELSE amount_cents END)::BIGINT AS net
             FROM credit_note_allocations
            WHERE invoice_id = v.id AND kind IN ('applied', 'released')
            GROUP BY credit_note_id
           HAVING SUM(CASE WHEN kind = 'released' THEN -amount_cents ELSE amount_cents END) > 0 LOOP
    PERFORM credit_note_allocate(a.credit_note_id, v.id, 'released', a.net, p_admin_id, false, NULL, NULL,
                                 'Invoice ' || v.number || ' voided');
    PERFORM invoice_log(v.id, 'credit_released', 'admin', p_admin_id, a.net, NULL,
                        jsonb_build_object('credit_note_id', a.credit_note_id));
  END LOOP;

  UPDATE invoices
     SET status = 'void', voided_at = now(), voided_by = p_admin_id, void_reason = btrim(p_reason),
         credited_cents = 0
   WHERE id = v.id;
  PERFORM invoice_log(v.id, 'voided', 'admin', p_admin_id, v.amount_cents, p_reason, '{}');
  RETURN invoice_result(v.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION admin_uninvoiced_commission()
RETURNS TABLE(event_id UUID, title TEXT, slug TEXT, starts_at TIMESTAMPTZ, timezone TEXT,
              organizer_id UUID, organizer_name TEXT, currency CHAR(3), owed_cents BIGINT,
              unpaid_invoice_cents BIGINT, uninvoiced_cents BIGINT, unpaid_invoice_id UUID,
              door_sales BIGINT, last_sale_at TIMESTAMPTZ) AS $$
  WITH owed AS (
    SELECT l.event_id, l.currency,
           SUM(CASE WHEN l.direction = 'credit' THEN l.amount_cents ELSE -l.amount_cents END)::BIGINT AS cents
      FROM ledger_entries l
     WHERE l.channel = 'manual'
     GROUP BY l.event_id, l.currency
  ), unpaid AS (
    SELECT i.event_id, i.currency,
           SUM(i.amount_cents - i.paid_cents - i.written_off_cents - i.credited_cents)::BIGINT AS cents,
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

-- ─── 8. Raising an invoice ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION raise_commission_invoice(p_event_id UUID, p_admin_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_event      RECORD;
  v_open       UUID;
  v_owed       BIGINT;
  v_from       TIMESTAMPTZ;
  v_now        TIMESTAMPTZ := now();
  v_count      INT;
  v_gross      BIGINT;
  v_commission BIGINT;
  v_tax        BIGINT;
  v_seq        INT;
  v_id         UUID;
  v_number     TEXT;
  v_issuer     JSONB;
  v_recipient  JSONB;
  v_check      JSONB;
  n            RECORD;
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

  -- No invoice without both parties' legal and tax details.
  v_check := invoice_billing_check(v_event.organizer_id);
  IF NOT (v_check->>'ok')::BOOLEAN THEN
    RETURN invoice_fail('BILLING_DETAILS_INCOMPLETE',
             CASE WHEN jsonb_array_length(v_check->'issuer_missing') > 0
                  THEN 'Eventsli''s invoicing details are incomplete (Settings → Invoice issuer). '
                  ELSE '' END ||
             CASE WHEN jsonb_array_length(v_check->'organizer_missing') > 0
                  THEN 'The organizer''s billing details are incomplete (organization profile). '
                  ELSE '' END ||
             'No invoice was issued.')
           || jsonb_build_object('issuer_missing', v_check->'issuer_missing',
                                 'organizer_missing', v_check->'organizer_missing');
  END IF;

  SELECT COALESCE(MAX(covers_to), '-infinity'::TIMESTAMPTZ) INTO v_from
    FROM invoices WHERE event_id = p_event_id AND status::TEXT <> 'void';

  SELECT count(*), COALESCE(SUM(buyer_total_cents), 0),
         COALESCE(SUM(commission_cents), 0), COALESCE(SUM(commission_tax_cents), 0)
    INTO v_count, v_gross, v_commission, v_tax
    FROM orders
   WHERE event_id = p_event_id AND channel = 'manual' AND status = 'paid'
     AND created_at > v_from AND created_at <= v_now;

  SELECT value INTO v_issuer FROM platform_settings WHERE key = 'invoice_issuer';
  SELECT jsonb_build_object(
           'organizer_id', o.id, 'legal_name', o.legal_name, 'display_name', o.display_name,
           'country', o.country, 'email', p.email, 'billing_address', o.billing_address,
           'tax_status', o.tax_status, 'tax_id', o.tax_id)
    INTO v_recipient
    FROM organizers o LEFT JOIN profiles p ON p.id = o.owner_user_id
   WHERE o.id = v_event.organizer_id;

  SELECT count(*) + 1 INTO v_seq FROM invoices WHERE event_id = p_event_id;
  v_number := 'INV-' || to_char(v_now, 'YYYYMMDD') || '-' || substr(p_event_id::TEXT, 1, 8) || '-' || v_seq;

  INSERT INTO invoices (organizer_id, event_id, number, currency, amount_cents, status,
                        covers_from, covers_to, order_count,
                        sales_count, sales_gross_cents, commission_cents, commission_tax_cents, adjustment_cents,
                        issuer, recipient)
  VALUES (v_event.organizer_id, p_event_id, v_number, v_event.currency, v_owed, 'open',
          NULLIF(v_from, '-infinity'::TIMESTAMPTZ), v_now, v_count,
          v_count, v_gross, v_commission, v_tax, v_owed - v_commission - v_tax,
          v_issuer, v_recipient)
  RETURNING id INTO v_id;

  -- Credit balance left on the event's credit notes is already inside v_owed
  -- (the ledger nets it). Recorded as netted here, so it cannot also be refunded.
  FOR n IN SELECT id, remaining_cents FROM credit_notes
            WHERE event_id = p_event_id AND currency = v_event.currency AND remaining_cents > 0 FOR UPDATE LOOP
    PERFORM credit_note_allocate(n.id, v_id, 'netted', n.remaining_cents, p_admin_id, false, NULL, NULL,
                                 'Netted on invoice ' || v_number);
  END LOOP;

  PERFORM invoice_log(v_id, 'raised', CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
                      p_admin_id, v_owed, NULL,
                      jsonb_build_object('order_count', v_count, 'commission_cents', v_commission,
                                         'commission_tax_cents', v_tax, 'adjustment_cents', v_owed - v_commission - v_tax));

  RETURN invoice_result(v_id, jsonb_build_object('order_count', v_count));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 9. Voiding or refunding a manual sale issues the credit note ─────────
CREATE OR REPLACE FUNCTION order_void_offline(
  p_order_id UUID, p_organizer_id UUID, p_actor UUID, p_role TEXT, p_kind TEXT, p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  o        orders;
  v_seats  UUID[];
  v_voided INT := 0;
  v_credit JSONB;
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

  -- The event first, then its invoice (inside credit_note_issue_for_order):
  -- the same order raise_commission_invoice locks them in.
  PERFORM 1 FROM events WHERE id = o.event_id FOR UPDATE;

  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL) INTO v_seats FROM tickets WHERE order_id = o.id;

  UPDATE tickets SET status = 'void' WHERE order_id = o.id AND status = 'valid';
  GET DIAGNOSTICS v_voided = ROW_COUNT;
  IF v_seats IS NOT NULL THEN
    UPDATE seats SET status = 'available', held_by_reservation = NULL WHERE id = ANY(v_seats) AND status = 'sold';
  END IF;

  UPDATE orders SET status = 'cancelled', voided_at = now(), voided_by = p_actor, void_kind = p_kind,
         void_reason = btrim(p_reason),
         refunded_cents = CASE WHEN p_kind = 'refund' THEN buyer_total_cents ELSE refunded_cents END
   WHERE id = o.id;

  -- Commission reversed: the organizer no longer owes it on this order.
  IF o.commission_cents > 0 THEN
    PERFORM ledger_write(o.event_id, o.organizer_id, o.id, 'manual', 'commission', 'debit',
      o.commission_cents, o.currency, 'm_commission_reversal_' || o.id);
  END IF;
  IF o.commission_tax_cents > 0 THEN
    PERFORM ledger_write(o.event_id, o.organizer_id, o.id, 'manual', 'commission_tax', 'debit',
      o.commission_tax_cents, o.currency, 'm_commission_tax_reversal_' || o.id);
  END IF;

  -- …and if an invoice already asked for it, a credit note takes it off.
  v_credit := credit_note_issue_for_order(o, p_actor, p_role, p_kind, p_reason);

  UPDATE offline_payments SET status = CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END,
         closed_at = now(), closed_by = p_actor, close_reason = btrim(p_reason)
   WHERE order_id = o.id;

  PERFORM payment_audit_write('order.' || CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END,
    o.event_id, o.organizer_id, o.id, NULL, o.buyer_total_cents, o.currency, p_actor, p_role, btrim(p_reason),
    jsonb_build_object('source', o.manual_source, 'tickets_voided', v_voided,
                       'commission_reversed_cents', o.commission_cents + o.commission_tax_cents,
                       'credit_note', v_credit));

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'tickets_voided', v_voided,
    'commission_reversed_cents', o.commission_cents + o.commission_tax_cents,
    'credit_note', v_credit);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 11. The admin overview's receivables, net of credit ──────────────────
-- Same function as before (live definition); only the two open-balance sums change.
CREATE OR REPLACE FUNCTION public.platform_overview(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                     COALESCE(sum(amount_cents - paid_cents - written_off_cents - credited_cents) FILTER (WHERE status IN ('open', 'submitted', 'overdue')), 0) AS open_cents,
                     COALESCE(sum(amount_cents - paid_cents - written_off_cents - credited_cents) FILTER (WHERE status = 'overdue'
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
$function$;

-- ─── 10. Privileges ────────────────────────────────────────────────────────
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'invoice_issuer_missing(JSONB)',
    'invoice_billing_check(UUID)',
    'invoice_refresh_status(UUID, UUID)',
    'invoice_result(UUID, JSONB)',
    'credit_note_allocate(UUID, UUID, TEXT, BIGINT, UUID, BOOLEAN, TEXT, TEXT, TEXT)',
    'credit_apply_to_unpaid(UUID, CHAR, UUID, TEXT)',
    'credit_note_issue_for_order(orders, UUID, TEXT, TEXT, TEXT)',
    'credit_note_refund(UUID, BIGINT, TEXT, TEXT, TEXT, UUID)',
    'invoice_record_payment(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID)',
    'settle_invoice(UUID, UUID, TEXT)',
    'invoice_waive(UUID, TEXT, UUID)',
    'invoice_reopen(UUID, TEXT, UUID)',
    'invoice_reverse_payment(UUID, TEXT, UUID)',
    'invoice_void(UUID, TEXT, UUID)',
    'admin_uninvoiced_commission()',
    'raise_commission_invoice(UUID, UUID)',
    'order_void_offline(UUID, UUID, UUID, TEXT, TEXT, TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION credit_notes_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION credit_note_allocations_guard() FROM PUBLIC, anon, authenticated;
