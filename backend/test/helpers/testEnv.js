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

// dotenv does not override an already-set variable, so a stray
// DISABLE_RATE_LIMIT=false in .env cannot undo the line above — but NODE_ENV
// could arrive as 'production' from a shell and silently re-enable limiting.
// Pinned, so a test run is never mistaken for a deployment.
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_ENV = 'test';
}

module.exports = {};
