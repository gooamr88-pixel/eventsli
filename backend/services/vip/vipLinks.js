const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A visitor's private link to their VIP request (2026-11-28): /vip/request/
 * <id>?t=<token>. Visitors have no account, so the link is the key, like a
 * booked demo's (services/demo/demoLinks.js).
 *
 * The token is an HMAC of the id under a server secret, never stored, so
 * every email carries the same link. VIP_LINK_SECRET is optional; without it
 * the key derives from JWT_SECRET (and rotating that breaks old links).
 * ─────────────────────────────────────────────────────────────────────────────
 */
function key() {
  const own = process.env.VIP_LINK_SECRET;
  if (own) return own;
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('vip links: VIP_LINK_SECRET or JWT_SECRET must be set');
  return crypto.createHash('sha256').update(`vip-request-links:${base}`).digest();
}

function tokenFor(id) {
  return crypto.createHmac('sha256', key()).update(`vip-request:${id}`).digest('base64url').slice(0, 32);
}

function tokenMatches(id, token) {
  if (!id || typeof token !== 'string' || token.length !== 32) return false;
  const want = Buffer.from(tokenFor(id));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function siteUrl() {
  return (process.env.FRONTEND_URL || '').split(',')[0].replace(/\/+$/, '');
}

/** The visitor's page, absolute for emails; relative when no site URL is set. */
function manageUrl(id) {
  return `${siteUrl()}/vip/request/${id}?t=${tokenFor(id)}`;
}

module.exports = { tokenFor, tokenMatches, manageUrl };
