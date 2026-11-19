/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AI work that outlives one HTTP request (2026-11-19).
 *
 * Reading a seating map from a picture takes Gemini longer than a minute on a
 * busy day, and production nginx ends every request at 60 s
 * (`proxy_read_timeout`, docs/DEPLOY.md). So the upload starts a job and
 * returns at once; the browser asks for the result every few seconds.
 *
 * IN MEMORY, ON PURPOSE. The backend runs as ONE pm2 fork process (see
 * ecosystem.config.js: fork, not cluster), so every poll reaches the process
 * that holds the job. A restart loses running jobs: the reservation they held
 * goes stale after `config.STALE` and stops counting, and the page says the
 * reading was lost, so the organizer tries again. No table, no migration.
 *
 * A job is visible only to the organization and event that started it, and
 * is forgotten ten minutes after it ends.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 500;
const jobs = new Map();

function sweep(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.endedAt && now - job.endedAt > TTL_MS) jobs.delete(id);
  }
}

/**
 * Starts `work` (an async function resolving to `{ ok: true, body }` or
 * `{ ok: false, status, error, message, meta }`; it must not throw) and
 * returns at once.
 */
function startJob(id, owner, work) {
  sweep();
  if (jobs.size >= MAX_JOBS) {
    // Oldest finished first; a running job is never dropped.
    for (const [key, job] of jobs) { if (job.endedAt) { jobs.delete(key); break; } }
  }
  const job = { ...owner, state: 'running', startedAt: Date.now(), endedAt: null, outcome: null };
  jobs.set(id, job);
  Promise.resolve()
    .then(work)
    .catch(() => ({ ok: false, status: 500, error: 'INTERNAL_ERROR', message: 'Something went wrong while reading the map. Try again.' }))
    .then((outcome) => {
      job.outcome = outcome;
      job.state = outcome?.ok ? 'done' : 'failed';
      job.endedAt = Date.now();
    });
  return id;
}

/** The job, if it exists AND belongs to this organization and event. */
function getJob(id, { organizerId, eventId }) {
  sweep();
  const job = jobs.get(id);
  if (!job || job.organizerId !== organizerId || job.eventId !== eventId) return null;
  return job;
}

/** Tests only. */
function _reset() { jobs.clear(); }

module.exports = { startJob, getJob, _reset, TTL_MS };
