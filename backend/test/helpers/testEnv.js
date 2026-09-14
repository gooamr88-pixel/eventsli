/**
 * Required FIRST by every integration test, before `app` is loaded.
 *
 * The rate limiters are built at module load and read the flag then, so setting
 * it here — before the require chain reaches them — is what makes it take
 * effect. Setting it later has no effect at all, which is a confusing way to
 * spend an afternoon.
 *
 * WHY the suite needs it: the limits are deliberately tight. Password reset is
 * eight requests an hour per IP, and a thorough test of a reset flow makes more
 * than eight. Without this the suite is throttled by its own protection and
 * reports a dozen 429s, which look like failures and say nothing about what is
 * being tested.
 *
 * `makeLimiter` refuses to honour the flag when NODE_ENV is production, so this
 * cannot weaken a deployed API even if the variable leaks into its environment.
 */
process.env.DISABLE_RATE_LIMIT = 'true';

require('dotenv').config();

/**
 * NEVER AGAINST PRODUCTION BY ACCIDENT.
 *
 * These tests create and delete users, events, orders and ledger rows. They
 * read the database from `backend/.env`, which on a developer machine points at
 * the LIVE project — so for months a plain `npm run test:integration` wrote test
 * rows into production and deleted them again. That is one failed `after()`
 * away from leaving debris, and one bug in a cleanup query away from deleting
 * something real.
 *
 * Local stacks run freely (CI uses `supabase start`, which is 127.0.0.1). A
 * remote project is refused unless EVENTSLI_TEST_REMOTE_DB names its project
 * ref exactly — a deliberate act, not a default, and it cannot be satisfied by
 * a copied `=true`.
 */
{
  const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);
  let host = '';
  try { host = new URL(process.env.SUPABASE_URL || '').hostname; } catch { /* reported below */ }
  if (!LOCAL_HOSTS.has(host)) {
    const ref = host.split('.')[0];
    if (!ref || process.env.EVENTSLI_TEST_REMOTE_DB !== ref) {
      throw new Error(
        `Refusing to run integration tests against "${host || 'an unset SUPABASE_URL'}". `
        + 'Point SUPABASE_URL at a local stack (supabase start), or set '
        + 'EVENTSLI_TEST_REMOTE_DB to that project ref if you really mean it.',
      );
    }
  }
}

// dotenv does not override an already-set variable, so a stray
// DISABLE_RATE_LIMIT=false in .env cannot undo the line above — but NODE_ENV
// could arrive as 'production' from a shell and silently re-enable limiting.
// Pinned, so a test run is never mistaken for a deployment.
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_ENV = 'test';
}

module.exports = {};
