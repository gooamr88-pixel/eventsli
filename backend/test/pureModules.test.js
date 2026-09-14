const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ENFORCES a rule that has now been broken three times.
 *
 * `eventRules`, `stripeErrors` and `googleTokens` are all pure logic — field
 * allowlists, error translation, token claim checks — and all three were first
 * written inside a file that requires `config/supabase`, which THROWS at module
 * load without a service key. Every one of them was therefore untestable
 * without live credentials, and every one had to be extracted afterwards.
 *
 * Writing the rule in a comment did not stop it happening again. This does:
 * each module below is loaded in a child process with the database environment
 * stripped, and must import cleanly.
 *
 * If this fails on a module you just wrote, the fix is to split it — not to add
 * it to an exception list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PURE_MODULES = [
  'services/eventRules.js',      // field authority + the status machine
  'services/stripeErrors.js',    // Stripe refusals → operator instructions
  'services/googleTokens.js',    // Google ID token claim checks
  'utils/money.js',              // all money arithmetic
  'utils/crypto.js',             // hashing, tokens, constant-time compare
  'utils/slug.js',               // URL slugs
  'utils/responseEnvelope.js',   // the response shape and error-code table
  'middleware/pagination.js',    // the list contract
  'services/scanTokens.js',      // the two gate credentials
  'services/shareLinks.js',      // the only place a shared link is built
  'services/emailCodes.js',      // one-time email codes
];

/**
 * Loads a module with SUPABASE_* and every other credential removed.
 *
 * A child process, because `require` caches: once any test in this process has
 * loaded the Supabase client, a module that depends on it would import fine
 * here and fail in a fresh one.
 */
function loadsWithoutCredentials(relativePath) {
  const abs = path.resolve(__dirname, '..', relativePath);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|STRIPE_|BREVO_|GOOGLE_|JWT_|QR_JWT_|IP_HASH_|REDIS_)/.test(key)) {
      delete env[key];
    }
  }
  // dotenv would put them straight back.
  env.DOTENV_CONFIG_PATH = path.resolve(__dirname, 'helpers', 'no-such.env');

  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(abs)});`], {
      env, stdio: 'pipe', timeout: 20_000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.stderr || err.message).split('\n').slice(0, 4).join(' ') };
  }
}

for (const mod of PURE_MODULES) {
  test(`${mod} loads with no database credentials`, () => {
    const result = loadsWithoutCredentials(mod);
    assert.equal(
      result.ok, true,
      `${mod} cannot be loaded without credentials, so its logic cannot be tested `
      + `without a live database. Split the pure part into its own file.\n  ${result.reason}`,
    );
  });
}

test('the list is not empty, so this file cannot silently pass', () => {
  // A guard on the guard: an accidental empty array would make every assertion
  // above disappear and the suite would still report green.
  assert.ok(PURE_MODULES.length >= 8);
});
