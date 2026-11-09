-- ═══════════════════════════════════════════════════════════════════════════
-- Check-in v2: one admission function for every door client (the /gate PWA
-- and the native check-in app), and the gaps the first one left open.
--
--   T-016  A transferred ticket's old QR still admitted the seller. The QR
--          now carries a version (`v`); a transfer bumps tickets.qr_version,
--          and a code older than the ticket is refused as `transferred`.
--   T-023  A ticket on an order that is no longer paid (cancelled, refunded
--          outside the void path) still scanned in. It is refused as `void`.
--   T-054  check_in_ticket / undo_check_in took a bare ticket id and never
--          looked at the event. v2 matches on (ticket, event).
--   —      Events that are not open (draft, pending review, rejected,
--          suspended, completed) admitted at a PIN device. Refused as
--          `event_not_open` — the same set staff sign-in already allows.
--   —      The replay check ran before the row lock, so two uploads of one
--          scan at the same instant could both miss it and the second came
--          back as `error` on the UNIQUE index. It is checked again under
--          the lock, and a unique violation is answered as the replay.
--   —      The door never saw a name: fulfilment stores attendee_name as
--          NULL. The answer now falls back to the buyer, and says so.
--   —      "Already scanned at 23:04" was printed in UTC. It is the event's
--          own time zone now.
--
-- Also: refusals about a ticket are logged (method + detail), scans record
-- HOW they were taken (scan | manual | offline), an offline admission that
-- turns out to be a duplicate is flagged as a `conflict`, and tickets get an
-- updated_at so a device can pull changes since its last sync.
--
-- DEPLOY ORDER: apply this BEFORE the API that calls check_in_ticket_v2.
-- The v1 functions are kept so a code-only rollback still has them; a later
-- migration drops them once v2 has been live for a release.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tickets ───────────────────────────────────────────────────────────────

-- 0 for every ticket that exists today, INCLUDING ones already transferred:
-- their current holder's emailed QR carries no version, and bumping them here
-- would turn those people away. Only transfers from now on move the credential.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS qr_version INT NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_qr_version_nonneg') THEN
    ALTER TABLE tickets ADD CONSTRAINT tickets_qr_version_nonneg CHECK (qr_version >= 0);
  END IF;
END $$;

-- What a device asks for when it refreshes its offline list: "everything that
-- changed for this event since X". Maintained by trigger so no write path can
-- forget it.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS tickets_event_updated_idx ON tickets (event_id, updated_at, id);

CREATE OR REPLACE FUNCTION touch_ticket_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tickets_touch_updated_at ON tickets;
CREATE TRIGGER tickets_touch_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION touch_ticket_updated_at();

-- ─── Scans ─────────────────────────────────────────────────────────────────
ALTER TABLE scans ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'scan';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS conflict BOOLEAN NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_method_known') THEN
    ALTER TABLE scans ADD CONSTRAINT scans_method_known CHECK (method IN ('scan', 'manual', 'offline'));
  END IF;
END $$;

-- The recent-arrivals feed and the arrivals timeline read by the door's clock.
CREATE INDEX IF NOT EXISTS scans_event_occurred_idx ON scans (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS scans_event_conflict_idx ON scans (event_id) WHERE conflict;

-- ─── Replay ────────────────────────────────────────────────────────────────
-- The answer a scan id already got, or NULL. Scoped to the event: a scan id
-- from another event's device is not this door's business, not even its result.
CREATE OR REPLACE FUNCTION check_in_replay(p_event_id UUID, p_client_scan_id TEXT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
           'ok', s.result = 'admitted',
           'result', s.result,
           'replay', true,
           'conflict', s.conflict,
           'ticket_id', s.ticket_id,
           'scanned_at', COALESCE(s.occurred_at, s.scanned_at))
    FROM scans s
   WHERE p_client_scan_id IS NOT NULL
     AND s.client_scan_id = p_client_scan_id
     AND s.event_id = p_event_id
   LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── check_in_ticket_v2 ────────────────────────────────────────────────────
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
         s.section_key, s.row_label, s.seat_number, tb.label AS table_label
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
  v_gate := scanner_is_locked(p_event_id);
  IF (v_gate->>'locked')::BOOLEAN THEN
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
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, method)
    VALUES (p_ticket_id, p_event_id, p_device_id, 'admitted', v_when, p_client_scan_id, v_method);
  EXCEPTION WHEN unique_violation THEN
    -- The same scan id on a different ticket. Rolled back to the savepoint, so
    -- the ticket above is untouched.
    RETURN COALESCE(check_in_replay(p_event_id, p_client_scan_id),
      jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.'));
  END;

  RETURN jsonb_build_object('ok', true, 'result', 'admitted', 'scanned_at', v_when) || v_card;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── undo_check_in_v2 ──────────────────────────────────────────────────────
-- Same as v1, scoped to the event: a device can only reverse an admission at
-- its own door.
CREATE OR REPLACE FUNCTION undo_check_in_v2(p_event_id UUID, p_ticket_id UUID, p_device_id UUID)
RETURNS JSONB AS $$
DECLARE v_status ticket_status;
BEGIN
  SELECT status INTO v_status FROM tickets
   WHERE id = p_ticket_id AND event_id = p_event_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found',
      'message', 'That ticket is not for this event.');
  END IF;
  IF v_status <> 'scanned' THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_scanned',
      'message', 'That ticket has not been scanned.');
  END IF;

  UPDATE tickets SET status = 'valid', scanned_at = NULL WHERE id = p_ticket_id;

  -- Its own log line rather than deleting the admission: the log is what an
  -- organizer reads to work out what happened at the door.
  INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, detail)
  VALUES (p_ticket_id, p_event_id, p_device_id, 'undone', now(), 'check-in reversed');

  RETURN jsonb_build_object('ok', true, 'result', 'undone', 'ticket_id', p_ticket_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION check_in_ticket_v2 IS
  'Admits a ticket exactly once, at its own event only. Replay-safe by client_scan_id; refuses transferred, unpaid, void and closed-event tickets.';

-- ─── Privileges ────────────────────────────────────────────────────────────
-- The API calls these with the service role. Nothing else may.
REVOKE ALL ON FUNCTION touch_ticket_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_in_replay(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_in_ticket_v2(UUID, UUID, INT, UUID, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION undo_check_in_v2(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_in_replay(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_in_ticket_v2(UUID, UUID, INT, UUID, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION undo_check_in_v2(UUID, UUID, UUID) TO service_role;
