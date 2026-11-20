-- ═══════════════════════════════════════════════════════════════════════════
-- Check-in hardening after the 2026-11-20 scanner audit.
--
--   H1  A closed gate could be bypassed. 20261115090000 records an offline
--       admission even when the gate has since shut, because the person is
--       already inside. But "offline" was only the phone's word: a device that
--       had just been told the gate was shut could still upload
--       {offlineVerdict: 'admitted'} and every one of those tickets went in.
--       The exemption now holds only for a scan the device made BEFORE it was
--       told the gate was shut (scan_devices.gate_lock_seen_at). Every answer
--       that carries the gate's state sets or clears that time: a scan refused
--       as `scanner_locked` (here), the status poll, the door's `me` and the
--       offline list (the API, via note_gate_seen).
--
--   H2  The offline list says, per ticket, whether an older (HS256) code can
--       exist for it at all (`legacy`). A phone with no signal cannot check
--       an HS256 signature, so it used to admit any HS256-shaped code whose
--       ticket was on its list — a forgery with any version, needing nothing
--       but the ticket id. A ticket whose only codes were ever signed with the
--       ES256 key is now refused on an HS256 code (mobile/src/gate/offlineDecision.ts).
--       `p_v2_since` is when this server started signing every code with that
--       key (platform_settings 'qr_v2_since', written by the API at boot).
--
--   PIN scan_devices.pin_short: which shared tablets still sign in with a PIN
--       under six digits, so the organizer can be asked to replace it.
--
--   L   A replayed scan id answers only for the SAME ticket. An id already
--       used for another ticket used to return that ticket's answer, and the
--       ticket actually scanned was never checked in.
--
-- DEPLOY ORDER: apply this BEFORE the API that calls note_gate_seen and passes
-- p_v2_since. The old API keeps working against it (the new argument has a
-- default, the column is nullable).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Built on 20261115090000 (the gate exemption) and 20261112090000 (the
  -- issued-ticket snapshot in the offline list).
  -- (A marker both 20261115090000 and this file's version carry, so a re-run passes.)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_in_ticket_v2' AND prosrc LIKE '%while scanning was switched off%') THEN
    RAISE EXCEPTION 'Apply 20261115090000_invoice_and_gate_control.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'event_door_manifest' AND prosrc LIKE '%issued_section%') THEN
    RAISE EXCEPTION 'Apply 20261112090000_seating_pricing_integrity.sql first.';
  END IF;
END $$;

-- ─── PINs under six digits are retired (owner, 2026-11-20) ─────────────────
-- A PIN is stored hashed, so its length is only known when it is typed: set
-- at each sign-in, false for a new PIN. NULL: not signed in since this
-- existed. The Devices page asks for a new PIN where it is true; from
-- SHORT_PIN_CUTOFF (API env) such a PIN is refused after it is checked.
ALTER TABLE scan_devices ADD COLUMN IF NOT EXISTS pin_short BOOLEAN;

-- ─── When this device was told the gate is shut ────────────────────────────
ALTER TABLE scan_devices ADD COLUMN IF NOT EXISTS gate_lock_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN scan_devices.gate_lock_seen_at IS
  'When this device was first told the gate is shut, since it was last told it is open. NULL: as far as it knows, the gate is open. An offline admission made after this time is not exempt from the lock.';

-- Set (keeping the FIRST time) or clear. A conditional update: the usual
-- status poll, with nothing changed, writes nothing.
CREATE OR REPLACE FUNCTION note_gate_seen(p_device_id UUID, p_locked BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF p_locked THEN
    UPDATE scan_devices SET gate_lock_seen_at = now()
     WHERE id = p_device_id AND gate_lock_seen_at IS NULL;
  ELSE
    UPDATE scan_devices SET gate_lock_seen_at = NULL
     WHERE id = p_device_id AND gate_lock_seen_at IS NOT NULL;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION note_gate_seen(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION note_gate_seen(UUID, BOOLEAN) TO service_role;

-- ─── check_in_ticket_v2 ────────────────────────────────────────────────────
-- From 20261115090000_invoice_and_gate_control.sql, with three changes, each
-- marked CHANGED (audit 2026-11-20).
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
  v_seen     TIMESTAMPTZ;
  v_exempt   BOOLEAN := false;
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
  -- CHANGED (audit 2026-11-20): only for the same ticket. A scan id already
  -- spent on another ticket is not this scan's answer.
  v_replay := check_in_replay(p_event_id, p_client_scan_id);
  IF v_replay IS NOT NULL THEN
    IF (v_replay->>'ticket_id')::UUID IS DISTINCT FROM p_ticket_id THEN
      RETURN jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.');
    END IF;
    RETURN v_replay;
  END IF;

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
  IF v_replay IS NOT NULL THEN
    IF (v_replay->>'ticket_id')::UUID IS DISTINCT FROM p_ticket_id THEN
      RETURN jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.');
    END IF;
    RETURN v_replay;
  END IF;

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
  -- EXCEPT an admission a phone ALREADY made offline (20261115090000): the
  -- person is inside, and refusing the upload only loses the record.
  --
  -- CHANGED (audit 2026-11-20): only one the phone made before it was TOLD
  -- the gate is shut. The claim is the phone's word; what the server told the
  -- device is not. A device that was refused as `scanner_locked`, or read a
  -- shut gate from the status poll or its list, cannot claim afterwards that
  -- it did not know.
  v_gate := scanner_is_locked(p_event_id);
  v_gate_shut := COALESCE((v_gate->>'locked')::BOOLEAN, false);
  IF v_gate_shut THEN
    SELECT gate_lock_seen_at INTO v_seen FROM scan_devices WHERE id = p_device_id;
    v_exempt := v_method = 'offline' AND COALESCE(p_offline_admitted, false)
                AND (v_seen IS NULL OR v_when < v_seen);
    IF NOT v_exempt THEN
      -- This answer tells the device. From now on it knows.
      PERFORM note_gate_seen(p_device_id, true);
      RETURN jsonb_build_object('ok', false, 'result', 'scanner_locked',
        'reason', v_gate->>'reason',
        'message', 'Scanning is switched off for this event.');
    END IF;
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

-- ─── event_door_manifest ───────────────────────────────────────────────────
-- From 20261112090000_seating_pricing_integrity.sql, with one change: each row
-- says whether an older (HS256) code can exist for the ticket — `legacy`.
--
-- A ticket's codes are made when they are shown or emailed, never stored. So
-- once every code is signed with the ES256 key (from `p_v2_since`), a ticket
-- created after that — and not transferred before it, which moves the code —
-- has never had an HS256 code. NULL `p_v2_since` (no key, or not recorded):
-- every ticket may have one, as before.
DROP FUNCTION IF EXISTS event_door_manifest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION event_door_manifest(
  p_event_id UUID,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_after_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 1000,
  p_names BOOLEAN DEFAULT false,
  p_v2_since TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
  WITH page AS (
    SELECT t.id, t.qr_version, t.status, o.status AS order_status, t.scanned_at, t.updated_at,
           t.attendee_name, t.transfer_count, o.guest_name, p.full_name,
           -- CHANGED (audit 2026-11-20): could an HS256 code exist for this ticket?
           (p_v2_since IS NULL
             OR (t.created_at < p_v2_since
                 AND (t.transferred_at IS NULL OR t.transferred_at < p_v2_since))) AS legacy,
           tt.name AS tier, COALESCE(t.issued_section, s.section_key) AS section_key, COALESCE(t.issued_row, s.row_label) AS row_label, COALESCE(t.issued_seat_number, s.seat_number) AS seat_number, (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END) AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND (p_since IS NULL OR t.updated_at > p_since)
       AND (p_after_at IS NULL OR (t.updated_at, t.id) > (p_after_at, p_after_id))
     ORDER BY t.updated_at, t.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 2000)
  )
  SELECT jsonb_build_object(
    'now', now(),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id,
               'v', qr_version,
               'status', CASE WHEN status = 'void' OR order_status <> 'paid' THEN 'void' ELSE status::TEXT END,
               'scannedAt', scanned_at,
               'updatedAt', updated_at,
               'legacy', legacy,
               'tier', tier,
               'seat', CASE WHEN seat_number IS NOT NULL
                         THEN concat_ws(' ', section_key, concat(row_label, seat_number)) END,
               'table', table_label,
               'holder', CASE WHEN p_names
                           THEN door_holder(attendee_name, transfer_count, guest_name, full_name) END)
             ORDER BY updated_at, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION event_door_manifest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION event_door_manifest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, BOOLEAN, TIMESTAMPTZ) TO service_role;
