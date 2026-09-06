-- ═══════════════════════════════════════════════════════════════════════════
-- Manual sales, and the commission they create (BRD §03, §18, §20).
--
-- The organizer takes the money directly — cash, transfer, whatever they
-- arrange — and records the sale here. We never touch it. What we are owed is
-- the commission on it, and that becomes an invoice.
--
-- ── THE LEDGER MEANS SOMETHING DIFFERENT PER CHANNEL, DELIBERATELY ──
--
--   ledger_balance_cents(event, currency, 'stripe') → 0
--   ledger_balance_cents(event, currency, 'manual') → what the organizer owes us
--
-- That is not an inconsistency to tidy away later; it is the two relationships
-- being genuinely different. On the card path the money passed through us and
-- Stripe already handed us our fee, so the position closes at zero. On the
-- manual path the money never came near us: the commission is a RECEIVABLE, and
-- a receivable that reads as zero is one nobody collects.
--
-- Concretely, a manual sale writes commission and commission_tax as CREDIT
-- (earned, not collected) and no sale, payment_fee or transfer entry — there
-- was no charge, no processing cost, and nothing to transfer. Settling the
-- invoice writes the matching DEBIT and the balance returns to zero.
--
-- BRD is explicit that manual commission is NOT netted off Stripe sales: the
-- two stay separate in the accounts, which is why `channel` is on every entry
-- and every balance query takes one.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'settlement';

-- Manual orders need a record of HOW the organizer was paid, for their own
-- reconciliation. Free text: we are not modelling the world's payment methods.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS manual_method TEXT,
  ADD COLUMN IF NOT EXISTS manual_note   TEXT,
  ADD COLUMN IF NOT EXISTS recorded_by   UUID REFERENCES profiles(id);

ALTER TABLE invoices
  -- Which orders this invoice covers. Set when it is raised, so a sale recorded
  -- afterwards lands on the NEXT invoice instead of silently changing a total
  -- the organizer was already told to pay.
  ADD COLUMN IF NOT EXISTS covers_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS covers_to   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_count INT NOT NULL DEFAULT 0;

-- ─── What is owed, right now ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION manual_commission_owed(p_event_id UUID, p_currency CHAR(3))
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END
  ), 0)::BIGINT
  FROM ledger_entries
  WHERE event_id = p_event_id AND currency = p_currency AND channel = 'manual';
$$ LANGUAGE sql STABLE;

-- ─── Recording a manual sale ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_manual_sale(
  p_event_id   UUID,
  p_seat_ids   UUID[],
  p_table_id   UUID,
  p_breakdown  JSONB,
  p_buyer      JSONB,
  p_method     TEXT,
  p_note       TEXT,
  p_recorded_by UUID
) RETURNS JSONB AS $$
DECLARE
  v_event    RECORD;
  v_order_id UUID;
  v_seats    UUID[] := COALESCE(p_seat_ids, ARRAY[]::UUID[]);
  v_locked   UUID[];
  v_tickets  INT := 0;
  v_key      TEXT;
BEGIN
  SELECT id, organizer_id, currency, status INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is not on sale.');
  END IF;

  -- A whole table brings its seats with it.
  IF p_table_id IS NOT NULL THEN
    PERFORM 1 FROM tables WHERE id = p_table_id FOR UPDATE;
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_seats
      FROM seats WHERE table_id = p_table_id;
  END IF;

  IF COALESCE(array_length(v_seats, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose the seats or the table that were sold.');
  END IF;

  -- Same locking discipline as the online path. A seat sold at the door and a
  -- seat sold on the website are the same piece of stock, and the door does not
  -- get to skip the check.
  SELECT array_agg(locked.id) INTO v_locked
  FROM (
    SELECT s.id FROM seats s
     WHERE s.id = ANY(v_seats) AND s.status = 'available'
     ORDER BY s.id FOR UPDATE OF s SKIP LOCKED
  ) AS locked;

  IF COALESCE(array_length(v_locked, 1), 0) <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
      'message', 'Some of those seats are already sold or held.');
  END IF;

  INSERT INTO orders (
    event_id, organizer_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    guest_name, guest_email, guest_phone,
    manual_method, manual_note, recorded_by, paid_at
  ) VALUES (
    p_event_id, v_event.organizer_id, NULL, 'manual', 'paid', v_event.currency,
    array_length(v_seats, 1),
    (p_breakdown->>'subtotalCents')::BIGINT,
    COALESCE((p_breakdown->>'eventTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0),
    0,                                    -- no card, no processing cost
    'organizer',
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    -- The organizer keeps everything: they collected it. What they owe us is
    -- the commission, and that is a debt, not a deduction from this order.
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    p_method, p_note, p_recorded_by, now()
  ) RETURNING id INTO v_order_id;

  UPDATE seats SET status = 'sold' WHERE id = ANY(v_seats);
  IF p_table_id IS NOT NULL THEN
    UPDATE tables SET status = 'sold' WHERE id = p_table_id;
  END IF;

  INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
  SELECT v_order_id, s.tier_id, s.id, s.table_id,
         s.section_key || ' ' || s.row_label || s.seat_number,
         seat_price_cents(s.id)
    FROM seats s WHERE s.id = ANY(v_seats);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id)
  SELECT v_order_id, p_event_id, s.id, s.table_id, s.tier_id
    FROM seats s WHERE s.id = ANY(v_seats);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  -- CREDIT, not debit: this is money we have EARNED and have NOT collected.
  v_key := v_order_id::TEXT;
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission', 'credit', (p_breakdown->>'commissionCents')::BIGINT,
      v_event.currency, 'm_commission_' || v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission_tax', 'credit', (p_breakdown->>'commissionTaxCents')::BIGINT,
      v_event.currency, 'm_commission_tax_' || v_key);
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets,
    'commission_owed_cents', manual_commission_owed(p_event_id, v_event.currency));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Raising an invoice ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION raise_commission_invoice(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_event   RECORD;
  v_open    UUID;
  v_owed    BIGINT;
  v_from    TIMESTAMPTZ;
  v_count   INT;
  v_id      UUID;
  v_number  TEXT;
BEGIN
  SELECT id, organizer_id, currency, starts_at INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;

  -- One open invoice at a time. Two would give the organizer two due dates for
  -- overlapping periods and no way to know which one closes the gate.
  SELECT id INTO v_open FROM invoices
   WHERE event_id = p_event_id AND status IN ('open', 'submitted', 'overdue')
   LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'There is already an unpaid invoice for this event.',
      'invoice_id', v_open);
  END IF;

  v_owed := manual_commission_owed(p_event_id, v_event.currency);
  IF v_owed <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
      'message', 'Nothing is outstanding for this event.');
  END IF;

  SELECT COALESCE(MAX(covers_to), '-infinity'::TIMESTAMPTZ) INTO v_from
    FROM invoices WHERE event_id = p_event_id;

  SELECT count(*) INTO v_count FROM orders
   WHERE event_id = p_event_id AND channel = 'manual' AND created_at > v_from;

  v_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_event_id::TEXT, 1, 8);

  INSERT INTO invoices (
    organizer_id, event_id, number, currency, amount_cents, status,
    covers_from, covers_to, order_count
  ) VALUES (
    v_event.organizer_id, p_event_id, v_number, v_event.currency, v_owed, 'open',
    NULLIF(v_from, '-infinity'::TIMESTAMPTZ), now(), v_count
  ) RETURNING id INTO v_id;
  -- due_at is filled by trg_set_invoice_due_at: 7 days, never later than 24h
  -- before doors, never sooner than 2h from now.

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'number', v_number,
    'amount_cents', v_owed, 'order_count', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Settling one ──────────────────────────────────────────────────────────
-- Only an admin reaches this, and only after seeing the proof. "They said they
-- paid" and "we saw the money" are different facts, and the gate reopens on the
-- second one.
CREATE OR REPLACE FUNCTION settle_invoice(p_invoice_id UUID, p_admin_id UUID, p_note TEXT)
RETURNS JSONB AS $$
DECLARE v_inv RECORD;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_inv IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_inv.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'invoice_id', p_invoice_id);
  END IF;

  UPDATE invoices
     SET status = 'paid', confirmed_by = p_admin_id,
         confirmed_at = now(), notes = COALESCE(p_note, notes)
   WHERE id = p_invoice_id;

  -- The matching DEBIT. This is what returns the manual balance to zero, and
  -- therefore what reopens the gate — there is no separate unlock step, because
  -- the lock is derived from the debt rather than stored beside it.
  PERFORM ledger_write(v_inv.event_id, v_inv.organizer_id, NULL, 'manual',
    'settlement', 'debit', v_inv.amount_cents, v_inv.currency,
    'settle_' || p_invoice_id::TEXT);

  RETURN jsonb_build_object('ok', true, 'invoice_id', p_invoice_id,
    'remaining_owed_cents', manual_commission_owed(v_inv.event_id, v_inv.currency));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Marking the overdue ───────────────────────────────────────────────────
-- Only a label: `scanner_is_locked` already derives the lock from due_at, so
-- the gate closes whether or not this has run. Its job is to give the organizer
-- something to see and the notifier something to send.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  UPDATE invoices SET status = 'overdue'
   WHERE status IN ('open', 'submitted') AND due_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION manual_commission_owed IS
  'What the organizer owes Eventsli on the manual channel. The stripe channel always balances to zero; manual is a receivables ledger.';
