const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { hashIp } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Sessions that can actually be ended.
 *
 * A bare JWT cannot be revoked — once signed it is valid until it expires, so
 * "log out everywhere", "ban this account" and "this device was stolen" are all
 * requests the system cannot honour. Every token we issue therefore carries a
 * `jti` matching a row here, and that row is consulted on every authenticated
 * request. The cost is one indexed lookup per request; the alternative is an
 * account you cannot lock.
 */

const SESSION_TTL_HOURS = 24;
const COOKIE_NAME = 'eventsli_session';

/**
 * `lax`, not `strict`.
 *
 * `strict` withholds the cookie on top-level navigations INTO the site, which
 * includes the redirect back from Stripe Checkout — so a buyer who just paid
 * would land on the success page logged out. `lax` still withholds it on
 * cross-site POSTs and embedded requests, which is the CSRF protection that
 * matters.
 */
function cookieOptions(maxAgeMs = SESSION_TTL_HOURS * 3600 * 1000) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

/**
 * Mint a session and its cookie.
 *
 * The cookie's lifetime is derived from the token's, never set independently: a
 * cookie that outlives its token just means the browser keeps resending
 * something the server already rejects, and the user sees a random logout
 * instead of a clean one.
 */
async function issue(res, { userId, email, role, req, ttlHours = SESSION_TTL_HOURS }) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  const { error } = await supabase.from('sessions').insert({
    jti,
    user_id: userId,
    expires_at: expiresAt.toISOString(),
    ip_hash: req ? hashIp(req.ip) : null,
    user_agent: req?.headers?.['user-agent']?.slice(0, 400) || null,
    last_seen_at: new Date().toISOString(),
  });
  // Fail closed: if the session row cannot be written, the token would be
  // unrevocable, so no token is issued at all.
  if (error) throw new Error(`could not create session: ${error.message}`);

  const token = jwt.sign(
    { sub: userId, email, role, jti },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${ttlHours}h` },
  );

  res.cookie(COOKIE_NAME, token, cookieOptions(ttlHours * 3600 * 1000));
  return { jti, token, expiresAt };
}

/**
 * Is this token's session still live?
 *
 * FAILS CLOSED at every branch. A lookup error used to be treated as "probably
 * fine" in systems like this, which means a revoked session slips through on a
 * transient database hiccup — precisely when you least want it to.
 */
async function isValid(decoded) {
  // No jti means the token predates this system or was forged. Either way it is
  // not revocable, so it is not accepted.
  if (!decoded?.jti) return false;

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('revoked_at, expires_at')
      .eq('jti', decoded.jti)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, jti: decoded.jti }, 'session lookup failed — denying');
      return false;
    }
    if (!data) return false;                 // revoked-and-purged, or forged
    if (data.revoked_at) return false;
    if (new Date(data.expires_at).getTime() < Date.now()) return false;
    return true;
  } catch (e) {
    logger.error({ err: e, jti: decoded?.jti }, 'session lookup threw — denying');
    return false;
  }
}

async function revoke(jti, reason = 'logout') {
  if (!jti) return;
  await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('jti', jti)
    .is('revoked_at', null);
}

/** Ends every live session for a user — password change, ban, "sign out everywhere". */
async function revokeAllForUser(userId, reason = 'revoke_all') {
  const { data, error } = await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('jti');
  if (error) throw new Error(`could not revoke sessions: ${error.message}`);
  return data?.length || 0;
}

async function listForUser(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('jti, issued_at, expires_at, last_seen_at, user_agent, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('issued_at', { ascending: false });
  return data || [];
}

/**
 * Best-effort activity stamp, so a user can tell which session is the one they
 * are looking at. Deliberately not awaited by callers and never allowed to fail
 * a request — it is a convenience, not a security control.
 */
function touch(jti) {
  if (!jti) return;
  supabase
    .from('sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('jti', jti)
    .then(undefined, (e) => logger.debug({ err: e }, 'session touch failed'));
}

function clearCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

module.exports = {
  issue,
  isValid,
  revoke,
  revokeAllForUser,
  listForUser,
  touch,
  clearCookie,
  cookieOptions,
  COOKIE_NAME,
  SESSION_TTL_HOURS,
};
