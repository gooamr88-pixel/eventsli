-- ═══════════════════════════════════════════════════════════════════════════
-- Check-in privacy (mobile/store/PRIVACY-AUDIT-FINAL.md, 2026-11-14)
--
--  1. ATTRIBUTION. A phone that held scans offline uploads them with whatever
--     door session is open when the signal returns. If the person who took
--     them signed out and a colleague signed in, every one of those scans was
--     recorded under the colleague's door device — and so under their name.
--     The upload now says which device took each scan; the server keeps that
--     device as `device_id` (when it belongs to the same event) and records
--     the device that carried the upload in `uploaded_by_device_id`. The
--     admission decision itself (check_in_ticket_v2) is unchanged.
--
--  2. RETENTION. `scans` — who was let in, when, through which door — was
--     never deleted. `scan_retention(keep_days, dry_run)` reports and, only
--     when asked, deletes the log of events that ended more than keep_days
--     ago. It never deletes:
--       • rows flagged as a conflict (let in twice offline): there is no
--         resolution workflow yet, so they count as unresolved;
--       • any event with an order whose card dispute is still open;
--       • any event with a retention hold (scan_retention_holds), the
--         documented way to keep records for a legal or operational reason.
--     The ticket keeps its own `scanned_at` (part of the order record, kept
--     for accounting); what goes is the per-scan log.
--     Pending scans do not exist on the server: they live on phones until
--     uploaded, and an upload after a purge simply writes new rows.
--
--  No data is changed by applying this file.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS uploaded_by_device_id UUID REFERENCES scan_devices(id) ON DELETE SET NULL;

COMMENT ON COLUMN scans.uploaded_by_device_id IS
  'Set only when a device uploaded scans another device of the same event took offline; device_id is the device that took the scan.';


CREATE TABLE IF NOT EXISTS scan_retention_holds (
  event_id    UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE scan_retention_holds IS
  'Events whose check-in log must be kept past the retention period (legal claim, investigation). Remove the row to release it.';

CREATE TABLE IF NOT EXISTS scan_retention_runs (
  id              BIGSERIAL PRIMARY KEY,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  keep_days       INT NOT NULL,
  dry_run         BOOLEAN NOT NULL,
  events_due      INT NOT NULL,
  events_held     INT NOT NULL,
  scans_eligible  BIGINT NOT NULL,
  scans_deleted   BIGINT NOT NULL,
  conflicts_kept  BIGINT NOT NULL
);

COMMENT ON TABLE scan_retention_runs IS
  'One row per scan_retention() call: what was due, what was kept and why, what was deleted. Counts only, no personal data.';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['scan_retention_holds', 'scan_retention_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE scan_retention_runs_id_seq FROM PUBLIC, anon, authenticated;


-- Per event: when it ended, what is due, what is kept and why.
CREATE OR REPLACE FUNCTION scan_retention(
  p_keep_days INT,
  p_dry_run   BOOLEAN DEFAULT true,
  -- Only these events (a pilot on one event, or a test); NULL = every event.
  p_event_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  event_id       UUID,
  ended_at       TIMESTAMPTZ,
  held_because   TEXT,
  scans_eligible BIGINT,
  conflicts_kept BIGINT,
  scans_deleted  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_deleted BIGINT;
  v_due INT := 0;
  v_held INT := 0;
  v_eligible BIGINT := 0;
  v_total_deleted BIGINT := 0;
  v_conflicts BIGINT := 0;
BEGIN
  -- A typo must not wipe last month's door log.
  IF p_keep_days IS NULL OR p_keep_days < 30 THEN
    RAISE EXCEPTION 'scan_retention: keep_days must be at least 30 (got %)', p_keep_days;
  END IF;

  FOR r IN
    SELECT e.id,
           COALESCE(e.ends_at, e.starts_at) AS ended,
           CASE
             WHEN h.event_id IS NOT NULL THEN 'retention hold: ' || h.reason
             WHEN EXISTS (
               SELECT 1 FROM orders o
                WHERE o.event_id = e.id
                  AND o.dispute_status IS NOT NULL
                  AND o.dispute_status NOT IN ('won', 'lost', 'warning_closed', 'prevented')
             ) THEN 'open card dispute'
           END AS held,
           (SELECT count(*) FROM scans s WHERE s.event_id = e.id AND NOT s.conflict) AS eligible,
           (SELECT count(*) FROM scans s WHERE s.event_id = e.id AND s.conflict) AS conflicts
      FROM events e
      LEFT JOIN scan_retention_holds h ON h.event_id = e.id
     WHERE COALESCE(e.ends_at, e.starts_at) IS NOT NULL
       AND COALESCE(e.ends_at, e.starts_at) < now() - make_interval(days => p_keep_days)
       AND (p_event_ids IS NULL OR e.id = ANY (p_event_ids))
       AND EXISTS (SELECT 1 FROM scans s WHERE s.event_id = e.id)
     ORDER BY 2
  LOOP
    v_due := v_due + 1;
    v_conflicts := v_conflicts + r.conflicts;
    v_deleted := 0;
    IF r.held IS NOT NULL THEN
      v_held := v_held + 1;
    ELSE
      v_eligible := v_eligible + r.eligible;
      IF NOT p_dry_run THEN
        DELETE FROM scans s WHERE s.event_id = r.id AND NOT s.conflict;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        v_total_deleted := v_total_deleted + v_deleted;
      END IF;
    END IF;

    event_id := r.id;
    ended_at := r.ended;
    held_because := r.held;
    scans_eligible := CASE WHEN r.held IS NULL THEN r.eligible ELSE 0 END;
    conflicts_kept := r.conflicts;
    scans_deleted := v_deleted;
    RETURN NEXT;
  END LOOP;

  INSERT INTO scan_retention_runs (keep_days, dry_run, events_due, events_held, scans_eligible, scans_deleted, conflicts_kept)
  VALUES (p_keep_days, p_dry_run, v_due, v_held, v_eligible, v_total_deleted, v_conflicts);
END;
$$;

REVOKE ALL ON FUNCTION scan_retention(INT, BOOLEAN, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION scan_retention(INT, BOOLEAN, UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';
