/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifying a Google ID token.
 *
 * No database import, deliberately. This is the THIRD time a pure function has
 * been written inside a file that reaches Supabase at module load, making it
 * untestable without live credentials — after `eventRules` and `stripeErrors`.
 * `test/pureModules.test.js` now enforces the rule instead of restating it.
 *
 * WHAT IS CHECKED, and why each one matters:
 *   • the token, against Google's tokeninfo — otherwise anyone can post a JSON
 *     blob claiming to be anyone;
 *   • `aud` equals OUR client id — a token minted for a DIFFERENT app is a
 *     perfectly valid Google token, and without this any developer with a
 *     Google client could sign in here as anyone. This is the important one;
 *   • `iss` is Google;
 *   • `email_verified` — accounts are matched BY EMAIL, so an unverified
 *     address would let someone claim one they do not own and walk into the
 *     password account already using it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const configured = () => !!process.env.GOOGLE_CLIENT_ID;

/**
 * Verified via Google's tokeninfo endpoint rather than by fetching JWKS and
 * checking the signature locally.
 *
 * The trade is a round trip per sign-in against not carrying our own JWKS
 * cache, key rotation and signature verification — three things that fail
 * quietly. Sign-in is not a hot path; if it becomes one, `google-auth-library`
 * does the local verification properly and this is the single place to swap.
 */
async function verifyIdToken(idToken) {
  if (!configured()) {
    // Closed, not open. With no client id there is no `aud` to compare against,
    // so "verify anyway" would accept every token in existence.
    throw fail('PAYMENT_REQUIRED', 'Google sign-in is not configured.');
  }

  let payload;
  try {
    const res = await fetch(`${TOKENINFO}?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
    payload = await res.json();
  } catch {
    // The reason is not passed on: an attacker probing does not need to know
    // whether we were rate limited, timed out, or read a real rejection.
    throw fail('INVALID_TOKEN', 'That Google sign-in could not be verified.');
  }

  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw fail('INVALID_TOKEN', 'That Google sign-in could not be verified.');
  }
  if (!ISSUERS.has(payload.iss)) {
    throw fail('INVALID_TOKEN', 'That Google sign-in could not be verified.');
  }
  // tokeninfo returns strings; a locally-verified JWT returns a boolean. Both
  // are the same fact.
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw fail('INVALID_TOKEN', 'That Google account has no verified email address.');
  }
  if (!payload.email) {
    throw fail('INVALID_TOKEN', 'That Google account did not share an email address.');
  }

  return {
    // Lower-cased: accounts are keyed on the address, and Someone@Example.com
    // is the same person as someone@example.com.
    email: String(payload.email).toLowerCase(),
    name: payload.name || null,
    googleId: payload.sub,
  };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { configured, verifyIdToken };
