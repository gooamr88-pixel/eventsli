-- ═══════════════════════════════════════════════════════════════════════════
-- Check-in at the gate.
--
-- Two properties decide whether this is correct, and both are about a queue of
-- people waiting to get in:
--
--   1. ONE ADMISSION PER TICKET. Two gates scanning the same code at the same
--      instant must produce exactly one entry and one clear refusal — not two
--      admissions, and not two refusals either.
--
--   2. A REPLAY IS NOT A SECOND SCAN. The scanner works offline and uploads its
--      queue later, sometimes twice. A replayed scan must return the ORIGINAL
--      result, so a guest admitted at 19:04 is still shown as admitted at
--      19:04 — not refused as a duplicate of themselves.
--
-- Both are handled by locking the ticket row and keying the scan on an id the
-- DEVICE generates. Only the first write wins; every later one reads it back.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  -- When the DEVICE recorded it, which is not when we received it. An offline
  -- gate uploads an hour later, and "who was inside at 8pm" must answer from
  -- the door's clock, not the server's.
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detail      TEXT;

CREATE INDEX IF NOT EXISTS scans_event_idx  ON scans (event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS scans_ticket_idx ON scans (ticket_id);

-- ─── Is the gate open? (BRD §18) ───────────────────────────────────────────
-- Unpaid commission disables the SCANNER for that event, and nothing else: the
-- organizer keeps their account, their other events, and their dashboard.
CREATE OR REPLACE FUNCTION scanner_is_locked(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_row     RECORD;
  v_overdue INT;
BEGIN
  SELECT is_locked, locked_reason, override_until
    INTO v_row FROM scanner_access WHERE event_id = p_event_id;

  -- A super-admin override outranks everything, including an overdue invoice.
  -- It exists for the case where the doors are open and 400 people are outside.
  IF v_row.override_until IS NOT NULL AND v_row.override_until > now() THEN
    RETURN jsonb_build_object('locked', false, 'override', true);
  END IF;

  IF COALESCE(v_row.is_locked, false) THEN
    RETURN jsonb_build_object('locked', true, 'reason', COALESCE(v_row.locked_reason, 'locked'));
  END IF;

  -- Derived, not cached: an invoice can fall overdue between one scan and the
  -- next, and a flag written by a nightly job would be a day stale at the door.
  SELECT count(*) INTO v_overdue
    FROM invoices
   WHERE event_id = p_event_id
     AND status IN ('open', 'submitted')
     AND due_at < now();

  IF v_overdue > 0 THEN
    RETURN jsonb_build_object('locked', true, 'reason', 'commission_overdue',
                              'overdue_invoices', v_overdue);
  END IF;

  RETURN jsonb_build_object('locked', false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ─── check_in_ticket ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_in_ticket(
  p_ticket_id      UUID,
  p_device_id      UUID,
  p_client_scan_id TEXT,
  p_occurred_at    TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_ticket  RECORD;
  v_event   RECORD;
  v_gate    JSONB;
  v_prior   RECORD;
  v_when    TIMESTAMPTZ := COALESCE(p_occurred_at, now());
BEGIN
  -- ── Replay first ──
  -- Before anything else: if this exact scan has already been recorded, return
  -- what it returned. Checking the ticket first would refuse a re-uploaded
  -- offline scan as a duplicate of itself.
  IF p_client_scan_id IS NOT NULL THEN
    SELECT * INTO v_prior FROM scans WHERE client_scan_id = p_client_scan_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', v_prior.result = 'admitted',
        'result', v_prior.result, 'replay', true, 'scanned_at', v_prior.scanned_at);
    END IF;
  END IF;

  SELECT t.id, t.event_id, t.status, t.scanned_at, t.attendee_name,
         s.section_key, s.row_label, s.seat_number, tb.label AS table_label
    INTO v_ticket
    FROM tickets t
    LEFT JOIN seats  s  ON s.id = t.seat_id
    LEFT JOIN tables tb ON tb.id = t.table_id
   WHERE t.id = p_ticket_id
     FOR UPDATE OF t;   -- the lock that makes two gates take turns

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found',
      'message', 'That ticket does not exist.');
  END IF;

  SELECT id, title, status, starts_at, ends_at INTO v_event
    FROM events WHERE id = v_ticket.event_id;

  v_gate := scanner_is_locked(v_ticket.event_id);
  IF (v_gate->>'locked')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'result', 'scanner_locked',
      'reason', v_gate->>'reason',
      'message', 'Scanning is switched off for this event.');
  END IF;

  IF v_event.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'result', 'event_cancelled',
      'message', 'This event was cancelled.');
  END IF;

  IF v_ticket.status = 'void' THEN
    RETURN jsonb_build_object('ok', false, 'result', 'void',
      'message', 'This ticket is no longer valid.');
  END IF;

  IF v_ticket.status = 'scanned' THEN
    -- The refusal carries WHEN. "Already used" starts an argument at the door;
    -- "already used at 19:04" ends one.
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, detail)
    VALUES (p_ticket_id, v_ticket.event_id, p_device_id, 'duplicate', v_when,
            p_client_scan_id, 'already scanned at ' || v_ticket.scanned_at);

    RETURN jsonb_build_object('ok', false, 'result', 'duplicate',
      'scanned_at', v_ticket.scanned_at,
      'attendee', v_ticket.attendee_name,
      'message', 'Already scanned at ' || to_char(v_ticket.scanned_at, 'HH24:MI'));
  END IF;

  UPDATE tickets
     SET status = 'scanned', scanned_at = v_when
   WHERE id = p_ticket_id;

  INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id)
  VALUES (p_ticket_id, v_ticket.event_id, p_device_id, 'admitted', v_when, p_client_scan_id);

  RETURN jsonb_build_object(
    'ok', true, 'result', 'admitted',
    'scanned_at', v_when,
    'attendee', v_ticket.attendee_name,
    'seat', CASE WHEN v_ticket.seat_number IS NOT NULL
      THEN v_ticket.section_key || ' ' || v_ticket.row_label || v_ticket.seat_number END,
    'table', v_ticket.table_label,
    'event_title', v_event.title
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Undo ──────────────────────────────────────────────────────────────────
-- Someone is scanned by mistake, or a device fires twice on one pass. Without
-- this the only remedy at the door is turning a paying guest away.
CREATE OR REPLACE FUNCTION undo_check_in(p_ticket_id UUID, p_device_id UUID)
RETURNS JSONB AS $$
DECLARE v_status ticket_status;
BEGIN
  SELECT status INTO v_status FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found');
  END IF;
  IF v_status <> 'scanned' THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_scanned',
      'message', 'That ticket has not been scanned.');
  END IF;

  UPDATE tickets SET status = 'valid', scanned_at = NULL WHERE id = p_ticket_id;

  -- Recorded as its own event rather than deleting the admission: the log is
  -- what an organizer reads to work out what happened at the door, and a scan
  -- that vanishes takes the explanation with it.
  INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, detail)
  SELECT p_ticket_id, event_id, p_device_id, 'undone', now(), 'check-in reversed'
    FROM tickets WHERE id = p_ticket_id;

  RETURN jsonb_build_object('ok', true, 'result', 'undone');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Gate stats ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION event_checkin_stats(p_event_id UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'issued',   count(*),
    'admitted', count(*) FILTER (WHERE status = 'scanned'),
    'pending',  count(*) FILTER (WHERE status = 'valid'),
    'void',     count(*) FILTER (WHERE status = 'void')
  )
  FROM tickets WHERE event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION check_in_ticket IS
  'Admits a ticket exactly once. Replay-safe by client_scan_id so an offline queue can be uploaded twice.';
COMMENT ON FUNCTION scanner_is_locked IS
  'BRD 18: the gate closes on an overdue commission invoice. Derived live, not cached, and overridable by a super admin.';
