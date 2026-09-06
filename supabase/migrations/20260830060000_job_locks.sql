-- ═══════════════════════════════════════════════════════════════════════════
-- Single-leader locks for the scheduled jobs.
--
-- pm2 runs the API with `instances: 'max'`, so every worker would otherwise run
-- every job. Eight processes releasing the same expired holds is merely wasteful;
-- eight processes sending the same organizer the same "scanning is switched off"
-- email is a support ticket.
--
-- ADVISORY locks, not a `job_runs` table with a flag. The difference is what
-- happens when a worker dies mid-job: an advisory lock is released by Postgres
-- when the session ends, while a flag stays set and the job never runs again
-- until somebody notices and clears it by hand.
--
-- pg_try_advisory_lock returns immediately rather than queuing — a worker that
-- loses simply skips this tick, which is the correct behaviour for something
-- that runs again in sixty seconds.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION try_job_lock(p_key INT)
RETURNS BOOLEAN AS $$
  SELECT pg_try_advisory_lock(p_key);
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION release_job_lock(p_key INT)
RETURNS BOOLEAN AS $$
  SELECT pg_advisory_unlock(p_key);
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION try_job_lock IS
  'Non-blocking single-leader guard for scheduled jobs. Released automatically if the holding session dies, which a table flag would not be.';
