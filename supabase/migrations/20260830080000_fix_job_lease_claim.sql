-- ═══════════════════════════════════════════════════════════════════════════
-- take_job_lease handed the lease to every caller sharing a holder id.
--
-- The first version had a fallback: if the UPDATE claimed nothing, check
-- whether a row exists for this holder taken in the last two seconds, and treat
-- that as a win. It was meant to cover "the INSERT was my claim, on the very
-- first run".
--
-- What it actually did was grant the lease to ANY caller with the same holder —
-- so three concurrent calls from one worker all won, which is precisely the
-- case the lease exists to prevent. In production each pm2 worker has its own
-- holder id, so this would have shown up rarely and looked like a mystery.
--
-- The fix removes the ambiguity rather than tightening the window: the INSERT
-- reports for itself whether it inserted. One of the two statements is the
-- claim, and nothing else is.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION take_job_lease(
  p_name    TEXT,
  p_seconds INT DEFAULT 300,
  p_holder  TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE v_claimed BOOLEAN := false;
BEGIN
  -- First run for this job: the INSERT itself is the claim. RETURNING is what
  -- makes it self-reporting — ON CONFLICT DO NOTHING is silent about which of
  -- two concurrent callers actually wrote the row.
  INSERT INTO job_leases (name, locked_until, holder)
  VALUES (p_name, now() + make_interval(secs => p_seconds), p_holder)
  ON CONFLICT (name) DO NOTHING;

  IF FOUND THEN
    RETURN true;
  END IF;

  -- Otherwise the row exists, and the claim is taking it over from an expired
  -- lease. One statement, so two callers cannot both pass a read-then-write.
  UPDATE job_leases
     SET locked_until = now() + make_interval(secs => p_seconds),
         holder = p_holder,
         taken_at = now()
   WHERE name = p_name
     AND locked_until < now();

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION take_job_lease IS
  'Claims a job lease. Exactly one caller wins: the INSERT claims it on first run, the UPDATE claims an expired one thereafter. No third path.';
