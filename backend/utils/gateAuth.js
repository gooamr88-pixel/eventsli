const scanTokens = require('../services/scanTokens');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where a door's token travels (audit 2026-11-20).
 *
 *   the app       `Authorization: Bearer <token>`, as always.
 *   the web gate  an httpOnly cookie scoped to /api/v1/scan, so no script on
 *                 the site can read it — it used to sit in localStorage. A
 *                 request carried by the cookie must ALSO send the header
 *                 `X-Eventsli-Gate: 1`. The cookie is SameSite=Strict already;
 *                 the header is the second lock, because a cross-site form or
 *                 image can make a browser send a cookie but cannot add a
 *                 header.
 *
 * Pure (no database), so the rules are unit-tested (test/gateAuth.test.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GATE_COOKIE = 'eventsli_gate';
const GATE_HEADER = 'x-eventsli-gate';
const GATE_COOKIE_PATH = '/api/v1/scan';

/** The door token on this request, from the Bearer header or the gate cookie; null if neither. */
function tokenFrom(req) {
  const header = req?.headers?.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7) || null;
  const cookie = req?.cookies?.[GATE_COOKIE];
  if (cookie && req.headers?.[GATE_HEADER] === '1') return cookie;
  return null;
}

/**
 * Whether the request carries a door token this server signed and that has not
 * expired. A signature check only — no database — so the limiter that uses it
 * (routes/scanRoutes.js) costs a busy door nothing.
 */
function hasSignedToken(req) {
  return Boolean(scanTokens.verifyScanToken(tokenFrom(req)));
}

function gateCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: GATE_COOKIE_PATH,
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

function clearGateCookie(res) {
  res.clearCookie(GATE_COOKIE, gateCookieOptions());
}

/**
 * A sign-in answer, for the client that asked. The web gate asks for a cookie
 * (`session: 'cookie'`): the token is set httpOnly and LEFT OUT of the answer,
 * so no script on the page ever holds it. The app asks for nothing and gets
 * the token in the body, as before.
 */
function withGateSession(req, res, result, maxAgeMs, now = Date.now()) {
  if (req?.body?.session !== 'cookie' || !result?.token) return result;
  res.cookie(GATE_COOKIE, result.token, gateCookieOptions(maxAgeMs));
  const { token, ...rest } = result;
  return { ...rest, session: 'cookie', expiresAt: new Date(now + maxAgeMs).toISOString() };
}

module.exports = {
  GATE_COOKIE, GATE_HEADER, GATE_COOKIE_PATH,
  tokenFrom, hasSignedToken, gateCookieOptions, clearGateCookie, withGateSession,
};
