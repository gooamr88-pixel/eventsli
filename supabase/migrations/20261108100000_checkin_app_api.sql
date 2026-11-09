-- ═══════════════════════════════════════════════════════════════════════════
-- What the native check-in app reads and signs in with.
--
--   • sessions.client / device_name — an app session is a normal, revocable
--     session row, labelled so the account's session list can say "Eventsli
--     Check-in on Sara's iPhone" and the owner can end it from the web.
--   • app_auth_codes — "Sign in with Eventsli": a one-time code, bound to a
--     PKCE challenge, that the app trades for a session. Stored hashed.
--   • event_gate_settings — what an organizer allows at their door: whether
--     the door team may search the guest list, whether devices may admit
--     offline, and whether names travel to the device for that.
--   • Read functions for the app's dashboard: the door list, recent scans, one
--     ticket's history, arrivals analytics, and per-event summaries for the
--     event picker. `door_holder` is the one place "who should be standing
--     here" is decided, so every screen names the same person.
--   • event_checkin_stats now counts only tickets on PAID orders, matching
--     what the door will actually admit (check_in_ticket_v2 refuses the rest).
--
-- SAFE TO DEPLOY IN EITHER ORDER relative to the API: nothing that exists
-- calls these yet, and the old event_checkin_stats signature is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Sessions ──────────────────────────────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_client_known') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_client_known
      CHECK (client IS NULL OR client IN ('web', 'checkin_app'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_device_name_len') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_device_name_len
      CHECK (device_name IS NULL OR char_length(device_name) <= 80);
  END IF;
END $$;

-- ─── Sign in with Eventsli (authorization code + PKCE) ─────────────────────
CREATE TABLE IF NOT EXISTS app_auth_codes (
  code_hash      TEXT PRIMARY KEY,                 -- sha256 of the code; the code itself is never stored
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,                    -- S256 of the app's verifier
  redirect_uri   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  CONSTRAINT app_auth_codes_challenge_shape CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  CONSTRAINT app_auth_codes_short_lived CHECK (expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS app_auth_codes_expires_idx ON app_auth_codes (expires_at);

-- ─── Door settings, per event ──────────────────────────────────────────────
-- A missing row means the defaults below; the API never requires one.
CREATE TABLE IF NOT EXISTS event_gate_settings (
  event_id                  UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- The door team sees counts and shortened names by default. The full guest
  -- list (search, manual check-in) is the organizer's to share.
  door_team_can_view_guests BOOLEAN NOT NULL DEFAULT false,
  -- Devices download the event's ticket list and decide offline.
  offline_admission         BOOLEAN NOT NULL DEFAULT true,
  -- Whether that list carries names. Off: the device shows tier and seat.
  offline_show_names        BOOLEAN NOT NULL DEFAULT false,
  -- Codes issued before signed QR v2 cannot be signature-checked on a device.
  -- 'allow' admits them on a list match; 'hold' waits for a connection.
  legacy_qr_offline         TEXT NOT NULL DEFAULT 'allow',
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT event_gate_settings_legacy_known CHECK (legacy_qr_offline IN ('allow', 'hold'))
);

-- Both tables: service role only, like everything else (20260914090000).
ALTER TABLE app_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_gate_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_auth_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON event_gate_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_auth_codes TO service_role;
GRANT ALL ON event_gate_settings TO service_role;

-- ─── Who the door should expect ────────────────────────────────────────────
-- The ticket's own name when it has one; otherwise the buyer — except after a
-- transfer, when the buyer is precisely the person who should NOT be there.
-- Mirrors check_in_ticket_v2.
CREATE OR REPLACE FUNCTION door_holder(
  p_attendee_name TEXT, p_transfer_count INT, p_guest_name TEXT, p_full_name TEXT
) RETURNS TEXT AS $$
  SELECT CASE
    WHEN NULLIF(btrim(p_attendee_name), '') IS NOT NULL THEN btrim(p_attendee_name)
    WHEN COALESCE(p_transfer_count, 0) > 0 THEN NULL
    ELSE COALESCE(NULLIF(btrim(p_guest_name), ''), NULLIF(btrim(p_full_name), ''))
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

-- ─── Gate stats, on paid orders only ───────────────────────────────────────
CREATE OR REPLACE FUNCTION event_checkin_stats(p_event_id UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'issued',   count(*),
    'admitted', count(*) FILTER (WHERE t.status = 'scanned'),
    'pending',  count(*) FILTER (WHERE t.status = 'valid'),
    'void',     count(*) FILTER (WHERE t.status = 'void')
  )
  FROM tickets t
  JOIN orders o ON o.id = t.order_id AND o.status = 'paid'
  WHERE t.event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── The door list ─────────────────────────────────────────────────────────
-- Valid and admitted tickets on paid orders. Searched by name, address or the
-- start of the ticket id; the address is matched, never returned. `p_q` is
-- expected already stripped of LIKE wildcards by the API.
CREATE OR REPLACE FUNCTION event_door_list(
  p_event_id UUID, p_q TEXT DEFAULT NULL, p_status TEXT DEFAULT 'all',
  p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
) RETURNS JSONB AS $$
  WITH base AS (
    SELECT t.id, t.status, t.scanned_at,
           door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name) AS holder,
           NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0 AS holder_is_buyer,
           COALESCE(t.attendee_email::TEXT, o.guest_email::TEXT, p.email::TEXT) AS email,
           tt.name AS tier,
           CASE WHEN s.seat_number IS NOT NULL
             THEN concat_ws(' ', s.section_key, concat(s.row_label, s.seat_number)) END AS seat,
           tb.label AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id AND o.status = 'paid'
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND t.status IN ('valid', 'scanned')
  ),
  filtered AS (
    SELECT * FROM base
     WHERE (COALESCE(p_status, 'all') = 'all'
            OR (p_status = 'in'  AND status = 'scanned')
            OR (p_status = 'out' AND status = 'valid'))
       AND (NULLIF(btrim(p_q), '') IS NULL
            OR holder ILIKE '%' || btrim(p_q) || '%'
            OR email  ILIKE '%' || btrim(p_q) || '%'
            OR id::TEXT LIKE lower(btrim(p_q)) || '%')
  ),
  page AS (
    SELECT * FROM filtered
     ORDER BY holder NULLS LAST, id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id, 'status', status, 'scannedAt', scanned_at,
               'holder', holder, 'holderIsBuyer', holder IS NOT NULL AND holder_is_buyer,
               'tier', tier, 'seat', seat, 'table', table_label)
             ORDER BY holder NULLS LAST, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Recent scans ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION event_recent_scans(
  p_event_id UUID, p_limit INT DEFAULT 20, p_before TIMESTAMPTZ DEFAULT NULL,
  p_admitted_only BOOLEAN DEFAULT true
) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(r ORDER BY at DESC, id DESC), '[]'::jsonb)
    FROM (
      SELECT sc.occurred_at AS at, sc.id, jsonb_build_object(
               'id', sc.id, 'result', sc.result, 'method', sc.method, 'conflict', sc.conflict,
               'at', sc.occurred_at, 'ticketId', sc.ticket_id,
               'holder', door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name),
               'tier', tt.name, 'device', d.label, 'staff', pr.full_name) AS r
        FROM scans sc
        LEFT JOIN tickets t        ON t.id = sc.ticket_id
        LEFT JOIN orders o         ON o.id = t.order_id
        LEFT JOIN profiles p       ON p.id = o.user_id
        LEFT JOIN ticket_tiers tt  ON tt.id = t.tier_id
        LEFT JOIN scan_devices d   ON d.id = sc.device_id
        LEFT JOIN event_staff es   ON es.id = d.staff_id
        LEFT JOIN profiles pr      ON pr.id = es.user_id
       WHERE sc.event_id = p_event_id
         AND sc.occurred_at IS NOT NULL
         AND (p_before IS NULL OR sc.occurred_at < p_before)
         AND (NOT COALESCE(p_admitted_only, true) OR sc.result = 'admitted')
       ORDER BY sc.occurred_at DESC, sc.id DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    ) x;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── One ticket, as the door sees it ───────────────────────────────────────
CREATE OR REPLACE FUNCTION ticket_door_detail(p_event_id UUID, p_ticket_id UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'ticketId', t.id,
    'status', t.status,
    'orderPaid', o.status = 'paid',
    'scannedAt', t.scanned_at,
    'qrVersion', t.qr_version,
    'transferred', t.transfer_count > 0,
    'holder', door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name),
    'holderIsBuyer', NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0
                     AND door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name) IS NOT NULL,
    'tier', tt.name,
    'seat', CASE WHEN s.seat_number IS NOT NULL
              THEN concat_ws(' ', s.section_key, concat(s.row_label, s.seat_number)) END,
    'table', tb.label,
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'result', sc.result, 'method', sc.method, 'conflict', sc.conflict,
               'at', COALESCE(sc.occurred_at, sc.scanned_at), 'device', d.label,
               'staff', pr.full_name, 'detail', sc.detail)
             ORDER BY COALESCE(sc.occurred_at, sc.scanned_at) DESC, sc.id DESC)
        FROM scans sc
        LEFT JOIN scan_devices d ON d.id = sc.device_id
        LEFT JOIN event_staff es ON es.id = d.staff_id
        LEFT JOIN profiles pr    ON pr.id = es.user_id
       WHERE sc.ticket_id = t.id AND sc.event_id = p_event_id), '[]'::jsonb)
  )
  FROM tickets t
  JOIN orders o             ON o.id = t.order_id
  LEFT JOIN profiles p      ON p.id = o.user_id
  LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
  LEFT JOIN seats s         ON s.id = t.seat_id
  LEFT JOIN tables tb       ON tb.id = t.table_id
  WHERE t.id = p_ticket_id AND t.event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Arrivals analytics ────────────────────────────────────────────────────
-- Built from the tickets' CURRENT state (an undone admission is not an
-- arrival), on paid orders, bucketed on the door's clock.
CREATE OR REPLACE FUNCTION event_checkin_analytics(p_event_id UUID, p_bucket_minutes INT DEFAULT 15)
RETURNS JSONB AS $$
  WITH bucket AS (
    SELECT LEAST(GREATEST(COALESCE(p_bucket_minutes, 15), 5), 120) * 60 AS secs
  ),
  tix AS (
    SELECT t.id, t.status, t.scanned_at, t.tier_id
      FROM tickets t
      JOIN orders o ON o.id = t.order_id AND o.status = 'paid'
     WHERE t.event_id = p_event_id
  ),
  arrived AS (
    SELECT id, scanned_at FROM tix WHERE status = 'scanned' AND scanned_at IS NOT NULL
  ),
  timeline AS (
    SELECT to_timestamp(floor(extract(epoch FROM a.scanned_at) / b.secs) * b.secs) AS at,
           count(*) AS n
      FROM arrived a, bucket b
     GROUP BY 1
  ),
  -- Who let each guest who is inside right now in: their latest admission.
  admitted_by AS (
    SELECT DISTINCT ON (sc.ticket_id) sc.ticket_id, sc.device_id, sc.method
      FROM scans sc
      JOIN arrived a ON a.id = sc.ticket_id
     WHERE sc.event_id = p_event_id AND sc.result = 'admitted'
     ORDER BY sc.ticket_id, sc.scanned_at DESC
  )
  SELECT jsonb_build_object(
    'bucketMinutes', (SELECT secs / 60 FROM bucket),
    'stats', (SELECT jsonb_build_object(
                'issued',   count(*),
                'admitted', count(*) FILTER (WHERE status = 'scanned'),
                'pending',  count(*) FILTER (WHERE status = 'valid'),
                'void',     count(*) FILTER (WHERE status = 'void')) FROM tix),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', at, 'admitted', n) ORDER BY at)
                            FROM timeline), '[]'::jsonb),
    'byTier', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tier', tier, 'issued', issued, 'admitted', admitted)
                       ORDER BY issued DESC, tier)
        FROM (SELECT tt.name AS tier,
                     count(*) FILTER (WHERE x.status <> 'void')    AS issued,
                     count(*) FILTER (WHERE x.status = 'scanned')  AS admitted
                FROM tix x LEFT JOIN ticket_tiers tt ON tt.id = x.tier_id
               GROUP BY tt.name) g), '[]'::jsonb),
    'byDevice', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('device', device, 'staff', staff, 'admitted', n)
                       ORDER BY n DESC, device)
        FROM (SELECT d.label AS device, pr.full_name AS staff, count(*) AS n
                FROM admitted_by ab
                LEFT JOIN scan_devices d ON d.id = ab.device_id
                LEFT JOIN event_staff es ON es.id = d.staff_id
                LEFT JOIN profiles pr    ON pr.id = es.user_id
               GROUP BY d.label, pr.full_name) g), '[]'::jsonb),
    'byMethod', COALESCE((
      SELECT jsonb_object_agg(method, n)
        FROM (SELECT COALESCE(method, 'scan') AS method, count(*) AS n FROM admitted_by GROUP BY 1) g),
      '{}'::jsonb),
    'refusals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('result', result, 'count', n) ORDER BY n DESC, result)
        FROM (SELECT result, count(*) AS n FROM scans
               WHERE event_id = p_event_id AND result NOT IN ('admitted', 'undone')
               GROUP BY result) g), '[]'::jsonb),
    'conflicts', (SELECT count(*) FROM scans WHERE event_id = p_event_id AND conflict),
    'lastFiveMinutes', (SELECT count(*) FROM arrived WHERE scanned_at > now() - interval '5 minutes'),
    'peak', (SELECT jsonb_build_object('at', at, 'admitted', n) FROM timeline ORDER BY n DESC, at LIMIT 1),
    'firstAt', (SELECT min(scanned_at) FROM arrived),
    'lastAt', (SELECT max(scanned_at) FROM arrived)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Per-event counts for the event picker ─────────────────────────────────
CREATE OR REPLACE FUNCTION event_checkin_summaries(p_event_ids UUID[])
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_object_agg(event_id, jsonb_build_object('issued', issued, 'admitted', admitted)),
                  '{}'::jsonb)
    FROM (SELECT t.event_id,
                 count(*) FILTER (WHERE t.status <> 'void')   AS issued,
                 count(*) FILTER (WHERE t.status = 'scanned') AS admitted
            FROM tickets t
            JOIN orders o ON o.id = t.order_id AND o.status = 'paid'
           WHERE t.event_id = ANY(p_event_ids)
           GROUP BY t.event_id) s;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION door_holder(TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_checkin_stats(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_door_list(UUID, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_recent_scans(UUID, INT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ticket_door_detail(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_checkin_analytics(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_checkin_summaries(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION door_holder(TEXT, INT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION event_checkin_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION event_door_list(UUID, TEXT, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION event_recent_scans(UUID, INT, TIMESTAMPTZ, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION ticket_door_detail(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION event_checkin_analytics(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION event_checkin_summaries(UUID[]) TO service_role;
