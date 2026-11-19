const crypto = require('node:crypto');

/**
 * The booker's "change or cancel" link token (2026-11-19).
 *
 * An HMAC of the booking id under a server secret, so it is never stored:
 * every email can carry the same link, and the link in the confirmation
 * still works after a reminder or a reschedule email went out. Unguessable
 * without the secret; checked in constant time.
 *
 * DEMO_LINK_SECRET is optional, like SMS_WEBHOOK_SECRET: without it the key
 * derives from JWT_SECRET, and rotating that would break outstanding links.
 */
function key() {
  const own = process.env.DEMO_LINK_SECRET;
  if (own) return own;
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('demo links: DEMO_LINK_SECRET or JWT_SECRET must be set');
  return crypto.createHash('sha256').update(`demo-manage-links:${base}`).digest();
}

function tokenFor(id) {
  return crypto.createHmac('sha256', key()).update(`demo-manage:${id}`).digest('base64url').slice(0, 32);
}

function tokenMatches(id, token) {
  if (!id || typeof token !== 'string' || token.length !== 32) return false;
  const want = Buffer.from(tokenFor(id));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { tokenFor, tokenMatches };
