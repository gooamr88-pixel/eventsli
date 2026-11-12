const { supabase } = require('../config/supabase');
const notices = require('./invoiceNotices');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The background jobs.
 *
 * Three database functions existed and correct for weeks with NOTHING calling
 * them. The tests invoked each one directly, so every one passed — and the
 * practical consequence was that an abandoned checkout held its seats forever.
 * A scheduled job with no scheduler is indistinguishable from a working one
 * until you look at production stock.
 *
 * ── SINGLE LEADER ──
 * pm2 runs the API with `instances: 'max'`. Without a guard every worker runs
 * every job: eight processes marking invoices overdue is survivable, eight
 * processes each sending the same organizer an email is not. A Postgres
 * ADVISORY LOCK makes exactly one worker win, and it is released automatically
 * if that worker dies — which a flag in a table would not be.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const timers = [];

const enabled = () => !/^(0|false|no|off)$/i.test(String(process.env.SCHEDULER_ENABLED ?? 'true'));

/**
 * Identifies THIS worker, so only the holder can release its own lease.
 *
 * pid alone is not enough — pm2 workers on one box share a pid space with
 * restarts, and a stale lease released by a new worker with a recycled pid
 * would let two run at once.
 */
const HOLDER = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Runs `fn` only if this worker wins the lease for `key`.
 *
 * A LEASE, not an advisory lock. `pg_try_advisory_lock` is SESSION scoped, and
 * every call here goes over PostgREST on a pooled connection — so the lock and
 * the unlock can land on different backends and three concurrent workers all
 * win. Worse, a session lock can be left held on a connection that is then
 * handed to unrelated traffic.
 *
 * A lease row works through any pooler, is visible when something is stuck, and
 * EXPIRES — so a worker that dies mid-job does not stop that job forever, which
 * is exactly the failure a boolean flag would have.
 */
async function withLeaderLock(key, fn, leaseSeconds = 300) {
  const { data: got, error } = await supabase.rpc('take_job_lease', {
    p_name: key, p_seconds: leaseSeconds, p_holder: HOLDER,
  });

  if (error) {
    logger.error({ err: error.message, key }, 'could not take the job lease — skipping this run');
    return null;
  }
  if (!got) return null;   // another worker holds it; not an error

  try {
    return await fn();
  } finally {
    // Released early so the next tick is not made to wait out the whole lease.
    // Scoped to this holder, or a slow worker's lease could be dropped by a
    // later one and both would run.
    await supabase.rpc('release_job_lease', { p_name: key, p_holder: HOLDER })
      .then(undefined, (e) => logger.error({ err: e.message, key }, 'could not release the job lease'));
  }
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

/**
 * Puts abandoned holds back on sale.
 *
 * The most consequential of the three: without it every abandoned checkout
 * permanently removes its seats from an event that may be selling out.
 */
async function expireReservations() {
  return withLeaderLock('expire-reservations', async () => {
    const { data, error } = await supabase.rpc('expire_stale_reservations');
    if (error) {
      logger.error({ err: error.message }, 'reservation sweep failed');
      return 0;
    }
    if (data > 0) logger.info({ released: data }, 'expired holds released');
    return data;
  });
}

/**
 * Labels overdue invoices and tells the organizer the gate has closed.
 *
 * The LABEL is cosmetic — `scanner_is_locked` derives the lock from `due_at`,
 * so the door shuts whether or not this ran. What is not cosmetic is the email:
 * an organizer discovering the closure from a queue at the door is the failure
 * this job exists to prevent.
 */
async function markOverdueInvoices() {
  return withLeaderLock('overdue-invoices', async () => {
    /**
     * ONE STATEMENT CLAIMS THEM (`claim_overdue_invoices`): it labels the open
     * ones 'overdue' and stamps `overdue_notified_at` on every invoice that has
     * just fallen due, returning exactly those.
     *
     * It used to read the crossing invoices, run the update separately, and
     * email what it had read — and it moved 'submitted' invoices to 'overdue'
     * too. So a receipt uploaded on an overdue invoice was knocked back out of
     * the review queue an hour later, with another "Scanning disabled" email
     * for every upload; and an invoice falling due between the read and the
     * update was labelled and never announced.
     */
    const { data: claimed, error } = await supabase.rpc('claim_overdue_invoices');
    if (error) {
      logger.error({ err: error.message }, 'overdue sweep failed');
      return 0;
    }

    for (const row of claimed || []) {
      // eslint-disable-next-line no-await-in-loop
      const sent = await notices.notifyOverdue(row.invoice_id);
      if (!sent?.sent) logger.warn({ invoiceId: row.invoice_id, reason: sent?.reason }, 'overdue notice not sent');
    }

    const count = (claimed || []).length;
    if (count > 0) logger.warn({ count }, 'invoices fell due; organizers told scanning is off');
    return count;
  });
}

/**
 * A reminder before an invoice falls due — once per invoice, `reminder_hours_before_due`
 * ahead (platform setting, default 48; 0 switches reminders off).
 *
 * Claimed in one statement (`claim_invoice_reminders`), so no invoice is
 * reminded twice. An admin who moves the due date clears the stamp, so the
 * reminder is sent again before the NEW date — the job follows the admin's
 * decision rather than the date it first saw. Invoices with a receipt waiting
 * are skipped: the organizer has done their part.
 */
async function sendInvoiceReminders() {
  return withLeaderLock('invoice-reminders', async () => {
    const { data: setting } = await supabase
      .from('platform_settings').select('value').eq('key', 'manual_invoice').maybeSingle();
    const raw = setting?.value?.reminder_hours_before_due;
    const hours = Number.isInteger(raw) ? raw : 48;
    if (hours <= 0) return 0;

    const { data: claimed, error } = await supabase.rpc('claim_invoice_reminders', { p_hours: hours });
    if (error) {
      logger.error({ err: error.message }, 'reminder sweep failed');
      return 0;
    }
    for (const row of claimed || []) {
      // eslint-disable-next-line no-await-in-loop
      const sent = await notices.notifyReminder(row.invoice_id);
      if (!sent?.sent) logger.warn({ invoiceId: row.invoice_id, reason: sent?.reason }, 'invoice reminder not sent');
    }
    return (claimed || []).length;
  });
}

/** Housekeeping. Long-expired sessions are dead weight on a per-request lookup. */
async function purgeSessions() {
  return withLeaderLock('purge-sessions', async () => {
    const { data, error } = await supabase.rpc('purge_expired_sessions');
    if (error) {
      logger.error({ err: error.message }, 'session purge failed');
      return 0;
    }
    return data;
  });
}

// ─── Wiring ────────────────────────────────────────────────────────────────

const JOBS = [
  // Every minute. A hold is 35 minutes, so a coarser sweep would leave stock
  // off sale for materially longer than it was ever held.
  { name: 'expire-reservations', everyMs: 60_000, run: expireReservations, immediate: true },
  // Hourly. Due dates are days apart; the email matters more than the minute.
  { name: 'overdue-invoices', everyMs: 3_600_000, run: markOverdueInvoices, immediate: false },
  // Hourly as well: a reminder 48 hours out does not need minute precision.
  { name: 'invoice-reminders', everyMs: 3_600_000, run: sendInvoiceReminders, immediate: false },
  { name: 'purge-sessions', everyMs: 6 * 3_600_000, run: purgeSessions, immediate: false },
  // SMS: dispatch, campaigns, reminders, reconciliation — services/sms/jobs.js.
  ...require('./sms/jobs').jobs(withLeaderLock),
];

function start() {
  if (!enabled()) {
    logger.warn('Scheduler is DISABLED (SCHEDULER_ENABLED=false). Abandoned holds will not be released.');
    return;
  }

  for (const job of JOBS) {
    const tick = async () => {
      try {
        await job.run();
      } catch (err) {
        // A job that throws must never take the process with it — this runs
        // inside the API, and a crashed worker is an outage.
        logger.error({ err: err.message, job: job.name }, 'scheduled job threw');
      }
    };

    if (job.immediate) tick();
    const t = setInterval(tick, job.everyMs);
    // Does not hold the process open on shutdown.
    if (t.unref) t.unref();
    timers.push(t);
  }

  logger.info({ jobs: JOBS.map((j) => j.name) }, 'scheduler started');
}

function stop() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

module.exports = { start, stop, expireReservations, markOverdueInvoices, sendInvoiceReminders, purgeSessions };
