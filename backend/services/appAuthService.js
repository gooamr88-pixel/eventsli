const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Sign in with Eventsli" for the native check-in app — an authorization code
 * with PKCE (RFC 7636), the standard shape for a native app.
 *
 *   1. The app makes a random `verifier`, sends only its SHA-256 (`challenge`)
 *      to eventsli.com in the system browser, where the person is — or
 *      becomes — signed in the ordinary way (password, Google, whatever the
 *      site offers). They press "Allow".
 *   2. The site asks the API for a one-time code bound to that challenge and
 *      hands it back to the app through the redirect URI.
 *   3. The app trades code + verifier for a session.
 *
 * The verifier never leaves the app, so a code intercepted on the way back —
 * another app registering the same URL scheme — is useless without it. The
 * code lives two minutes, is single-use, and only its hash is stored.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CODE_TTL_SECONDS = 120;

/** Where the app may be sent back to. Overridable for staging builds. */
function allowedRedirects() {
  const fromEnv = String(process.env.CHECKIN_APP_REDIRECT_URIS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(fromEnv.length ? fromEnv : ['eventsli-checkin://auth/callback']);
}

function isAllowedRedirect(uri) {
  return allowedRedirects().has(String(uri || ''));
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const hashCode = (code) => sha256(code).toString('hex');

/** S256: base64url(sha256(verifier)), compared in constant time. */
function challengeMatches(verifier, challenge) {
  const expected = Buffer.from(sha256(verifier).toString('base64url'));
  const given = Buffer.from(String(challenge || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * Step 2. `userId` is the person signed in on the website who pressed Allow.
 */
async function createCode({ userId, codeChallenge, redirectUri }) {
  const code = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();

  const { error } = await supabase.from('app_auth_codes').insert({
    code_hash: hashCode(code),
    user_id: userId,
    code_challenge: codeChallenge,
    redirect_uri: redirectUri,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(`could not create sign-in code: ${error.message}`);

  // Housekeeping, never allowed to fail the request: codes are worthless once
  // expired, so a day-old one is only clutter.
  supabase.from('app_auth_codes').delete()
    .lt('expires_at', new Date(now - 86400e3).toISOString())
    .then(undefined, (e) => logger.debug({ err: e }, 'app code purge failed'));

  return { code, expiresIn: CODE_TTL_SECONDS };
}

/**
 * Step 3. The user id the code was issued to, or null.
 *
 * The code is CLAIMED before the verifier is checked, in one conditional
 * update: a second redemption — a replay, or two racing requests — finds it
 * already used. A wrong verifier burns the code too, so it cannot be guessed
 * at; the person simply signs in again.
 */
async function redeemCode({ code, codeVerifier, redirectUri }) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('app_auth_codes')
    .update({ used_at: nowIso })
    .eq('code_hash', hashCode(code))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('user_id, code_challenge, redirect_uri')
    .maybeSingle();

  if (error) throw new Error(`could not redeem sign-in code: ${error.message}`);
  if (!data) return null;
  if (data.redirect_uri !== redirectUri) return null;
  if (!challengeMatches(codeVerifier, data.code_challenge)) return null;
  return data.user_id;
}

module.exports = {
  createCode, redeemCode, isAllowedRedirect, challengeMatches, CODE_TTL_SECONDS,
};
