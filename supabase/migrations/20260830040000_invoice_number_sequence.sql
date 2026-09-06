-- ═══════════════════════════════════════════════════════════════════════════
-- An event could only be invoiced once per day.
--
-- The number was `INV-<YYYYMMDD>-<first 8 of event id>`, which is unique per
-- event per DAY. Settle an invoice and raise the next one the same afternoon —
-- an entirely ordinary sequence when a run of door sales follows a settlement —
-- and it fails on `invoices_number_key`.
--
-- Nothing about that failure points at the cause: the caller sees a unique
-- violation on a column they never set. Adding a per-event sequence makes the
-- number carry the one fact it was missing, and keeps it readable to a human
-- reconciling a bank statement.
--
--   INV-20260830-a1b2c3d4-2
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION raise_commission_invoice(p_event_id UUID)
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
  SELECT id, organizer_id, currency, starts_at INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;

  -- One open invoice at a time. Two would give the organizer two due dates for
  -- overlapping periods and no way to know which one closes the gate. This also
  -- serialises the numbering below, so the sequence cannot race with itself.
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

  -- Everything since the last invoice closed. A sale recorded after this point
  -- lands on the NEXT invoice rather than silently changing a total the
  -- organizer was already told to pay.
  SELECT COALESCE(MAX(covers_to), '-infinity'::TIMESTAMPTZ) INTO v_from
    FROM invoices WHERE event_id = p_event_id;

  SELECT count(*) INTO v_count FROM orders
   WHERE event_id = p_event_id AND channel = 'manual' AND created_at > v_from;

  SELECT count(*) + 1 INTO v_seq FROM invoices WHERE event_id = p_event_id;

  v_number := 'INV-' || to_char(now(), 'YYYYMMDD')
           || '-' || substr(p_event_id::TEXT, 1, 8)
           || '-' || v_seq;

  INSERT INTO invoices (
    organizer_id, event_id, number, currency, amount_cents, status,
    covers_from, covers_to, order_count
  ) VALUES (
    v_event.organizer_id, p_event_id, v_number, v_event.currency, v_owed, 'open',
    NULLIF(v_from, '-infinity'::TIMESTAMPTZ), now(), v_count
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'number', v_number,
    'amount_cents', v_owed, 'order_count', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
