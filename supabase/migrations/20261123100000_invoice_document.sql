-- ═══════════════════════════════════════════════════════════════════════════
-- A commission invoice that is a real invoice (owner request 2026-11-17).
--
-- An invoice was one number — "amount_cents" — with an order count. Nothing on
-- it said who issued it, to whom, on what sales, or how much of it was tax.
-- That is not a document an organizer abroad can pay from or file.
--
-- Now, FROZEN AT ISSUE (later edits to the organizer or to Eventsli's details
-- never rewrite an invoice already sent):
--
--   sales_count, sales_gross_cents   the paid sales it covers (door sales and
--                                    confirmed offline reservations), and what
--                                    buyers paid for them
--   commission_cents                 Eventsli's commission on those sales
--   commission_tax_cents             tax on that commission
--   adjustment_cents                 everything else in the amount: a credit
--                                    from sales voided or refunded after an
--                                    earlier invoice (negative), or an earlier
--                                    balance carried forward. amount_cents =
--                                    commission + tax + adjustment, always.
--   issuer                           Eventsli's legal name, address, tax/business
--                                    number and contact, from the new
--                                    `invoice_issuer` setting
--   recipient                        the organizer's legal and display name,
--                                    country and email
--
-- Invoices raised before this migration keep these columns NULL; the invoice
-- page says they were issued before itemisation.
--
-- Currency is unchanged: the event's own (owner decision pending on USD/CAD).
-- Redefines raise_commission_invoice from 20261122090000 (same rules, same
-- amount, plus the breakdown). Needs 20261122090000.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sales_count INT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sales_gross_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS commission_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS commission_tax_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS adjustment_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuer JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_breakdown_adds_up') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoice_breakdown_adds_up CHECK (
      commission_cents IS NULL
      OR commission_cents + commission_tax_cents + adjustment_cents = amount_cents
    );
  END IF;
END $$;

-- Who issues the invoices. Empty until a super admin fills it in (Settings).
INSERT INTO platform_settings (key, value)
VALUES ('invoice_issuer', '{}')
ON CONFLICT (key) DO NOTHING;

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

  -- The sales this invoice is for: paid manual orders (door and offline) since
  -- the last non-void invoice. Voided or refunded ones are not sales.
  SELECT count(*), COALESCE(SUM(buyer_total_cents), 0),
         COALESCE(SUM(commission_cents), 0), COALESCE(SUM(commission_tax_cents), 0)
    INTO v_count, v_gross, v_commission, v_tax
    FROM orders
   WHERE event_id = p_event_id AND channel = 'manual' AND status = 'paid'
     AND created_at > v_from AND created_at <= v_now;

  SELECT COALESCE(value, '{}'::jsonb) INTO v_issuer FROM platform_settings WHERE key = 'invoice_issuer';
  SELECT jsonb_build_object(
           'organizer_id', o.id, 'legal_name', o.legal_name, 'display_name', o.display_name,
           'country', o.country, 'email', p.email)
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
          COALESCE(v_issuer, '{}'::jsonb), v_recipient)
  RETURNING id INTO v_id;

  PERFORM invoice_log(v_id, 'raised', CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
                      p_admin_id, v_owed, NULL,
                      jsonb_build_object('order_count', v_count, 'commission_cents', v_commission,
                                         'commission_tax_cents', v_tax, 'adjustment_cents', v_owed - v_commission - v_tax));

  RETURN invoice_result(v_id, jsonb_build_object('order_count', v_count));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
