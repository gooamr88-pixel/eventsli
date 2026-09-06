-- ═══════════════════════════════════════════════════════════════════════════
-- TWO BUGS, BOTH FOUND BY RUNNING THE SCHEDULER RATHER THAN THE SQL.
--
-- ── 1. Labelling an invoice overdue REOPENED the gate ──
--
-- scanner_is_locked counted invoices with `status IN ('open','submitted')` past
-- their due date. `mark_overdue_invoices` then moves exactly those rows to
-- 'overdue' — which is not in that list. So the hourly job whose entire purpose
-- is to flag an unpaid invoice was, as its side effect, UNLOCKING the door it
-- had just closed.
--
-- Every existing test passed: the gate tests never ran the labeller, and the
-- labeller tests never checked the gate. It took a test that did both, in
-- order, to see it.
--
-- ── 2. Session advisory locks do not survive a connection pooler ──
--
-- try_job_lock used pg_try_advisory_lock, which is SESSION scoped. Every
-- PostgREST call is its own request over a pooled connection, so the lock and
-- the unlock can land on different backends: three concurrent workers all won.
-- Worse, a lock could be left held on a connection then handed to unrelated
-- traffic.
--
-- Replaced with a LEASE table. It works through any pooler, it is visible when
-- something is stuck, and an expired lease is reclaimed automatically — so a
-- worker that dies mid-job does not stop that job forever, which is the failure
-- a boolean flag would have.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. The gate ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION scanner_is_locked(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_row     RECORD;
  v_overdue INT;
BEGIN
  SELECT is_locked, locked_reason, override_until
    INTO v_row FROM scanner_access WHERE event_id = p_event_id;

  IF v_row.override_until IS NOT NULL AND v_row.override_until > now() THEN
    RETURN jsonb_build_object('locked', false, 'override', true);
  END IF;

  IF COALESCE(v_row.is_locked, false) THEN
    RETURN jsonb_build_object('locked', true, 'reason', COALESCE(v_row.locked_reason, 'locked'));
  END IF;

  -- 'overdue' belongs here. Without it the labelling job reopens the gate.
  -- Every status that means "still owed" must be counted; only 'paid' and
  -- 'waived' end the debt.
  SELECT count(*) INTO v_overdue
    FROM invoices
   WHERE event_id = p_event_id
     AND status IN ('open', 'submitted', 'overdue')
     AND due_at < now();

  IF v_overdue > 0 THEN
    RETURN jsonb_build_object('locked', true, 'reason', 'commission_overdue',
                              'overdue_invoices', v_overdue);
  END IF;

  RETURN jsonb_build_object('locked', false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ─── 2. Job leases ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_leases (
  name         TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  holder       TEXT,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE job_leases IS
  'Single-leader guard for scheduled jobs. A lease, not a flag: it expires, so a worker that dies mid-job does not stop that job forever.';

/**
 * Claims a lease, atomically.
 *
 * The UPDATE ... WHERE expired IS the claim — one statement, so two workers
 * arriving together cannot both pass a read-then-write. A row that does not
 * exist yet is created by the INSERT, whose ON CONFLICT DO NOTHING means the
 * loser of that race simply falls through to the UPDATE.
 */
CREATE OR REPLACE FUNCTION take_job_lease(
  p_name    TEXT,
  p_seconds INT DEFAULT 300,
  p_holder  TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE v_got INT;
BEGIN
  INSERT INTO job_leases (name, locked_until, holder)
  VALUES (p_name, now() + make_interval(secs => p_seconds), p_holder)
  ON CONFLICT (name) DO NOTHING;

  UPDATE job_leases
     SET locked_until = now() + make_interval(secs => p_seconds),
         holder = p_holder,
         taken_at = now()
   WHERE name = p_name
     AND locked_until < now();
  GET DIAGNOSTICS v_got = ROW_COUNT;

  -- The INSERT above may itself have been the claim, on the very first run.
  IF v_got = 0 THEN
    SELECT count(*) INTO v_got FROM job_leases
     WHERE name = p_name AND holder IS NOT DISTINCT FROM p_holder
       AND taken_at > now() - interval '2 seconds';
  END IF;

  RETURN v_got > 0;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

/** Releases early, so the next tick is not made to wait out the whole lease. */
CREATE OR REPLACE FUNCTION release_job_lease(p_name TEXT, p_holder TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE v_n INT;
BEGIN
  UPDATE job_leases SET locked_until = now() - interval '1 second'
   WHERE name = p_name
     -- Only the holder may release it. Otherwise a slow worker's lease could be
     -- dropped by a later one, and both would run.
     AND (p_holder IS NULL OR holder IS NOT DISTINCT FROM p_holder);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS try_job_lock(INT);
DROP FUNCTION IF EXISTS release_job_lock(INT);
