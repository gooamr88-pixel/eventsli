/**
 * Retention for the check-in log (`scans`), the server half of the privacy
 * audit (mobile/store/PRIVACY-AUDIT-FINAL.md). The rules live in the database
 * function scan_retention() (migration 20261118090000): events that ended more
 * than N days ago lose their per-scan log, except conflicts, events with an
 * open card dispute, and events under a retention hold.
 *
 * Configuration (backend/.env):
 *   SCAN_RETENTION_MODE  off (default) | report | delete
 *                        report: the scheduler logs what WOULD be deleted, daily.
 *                        delete: it deletes. Turn on only after an approved
 *                        report (scripts/scan-retention.js).
 *   SCAN_RETENTION_DAYS  days after the event ends (default 90, minimum 30).
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

const DEFAULT_DAYS = 90;
const MIN_DAYS = 30;
const MODES = new Set(['off', 'report', 'delete']);

/** The configured policy. Anything unreadable falls back to doing nothing. */
function policy(env = process.env) {
  const raw = String(env.SCAN_RETENTION_MODE || 'off').trim().toLowerCase();
  const mode = MODES.has(raw) ? raw : 'off';
  const parsed = Number.parseInt(env.SCAN_RETENTION_DAYS, 10);
  const days = Number.isFinite(parsed) ? parsed : DEFAULT_DAYS;
  if (days < MIN_DAYS) {
    // Refuse rather than clamp: a short window is a mistake to fix, not to guess at.
    return { mode: 'off', days, error: `SCAN_RETENTION_DAYS must be at least ${MIN_DAYS}` };
  }
  return { mode, days, error: null };
}

/** One pass. `dryRun` true reports only; the database records every pass either way. */
async function run({ days, dryRun = true, eventIds = null }) {
  const { data, error } = await supabase.rpc('scan_retention', {
    p_keep_days: days, p_dry_run: dryRun, p_event_ids: eventIds && eventIds.length ? eventIds : null,
  });
  if (error) throw new Error(`scan_retention failed: ${error.message}`);
  const rows = data || [];
  const sum = (k) => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
  return {
    dryRun,
    days,
    events: rows.length,
    held: rows.filter((r) => r.held_because).map((r) => ({ eventId: r.event_id, endedAt: r.ended_at, because: r.held_because })),
    eligible: sum('scans_eligible'),
    conflictsKept: sum('conflicts_kept'),
    deleted: sum('scans_deleted'),
    rows,
  };
}

/** The scheduler's daily job. Off unless SCAN_RETENTION_MODE says otherwise. */
async function scheduled(withLeaderLock, env = process.env) {
  const p = policy(env);
  if (p.error) {
    logger.error({ days: p.days }, p.error);
    return null;
  }
  if (p.mode === 'off') return null;
  return withLeaderLock('scan-retention', async () => {
    const r = await run({ days: p.days, dryRun: p.mode !== 'delete' });
    logger.info({
      mode: p.mode, days: p.days, events: r.events, held: r.held.length,
      eligible: r.eligible, conflictsKept: r.conflictsKept, deleted: r.deleted,
    }, p.mode === 'delete' ? 'scan retention: old check-in logs deleted' : 'scan retention: report only');
    return r;
  });
}

module.exports = { policy, run, scheduled, DEFAULT_DAYS, MIN_DAYS };
