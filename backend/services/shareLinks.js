const { slugify } = require('../utils/slug');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The links an organizer shares, built ONLY here, on the server.
 *
 * A QR code is a link printed on a poster, and whoever controls the text inside
 * it controls where a phone goes. So the browser never supplies a URL to encode:
 * it names an event it owns and, optionally, one of that event's ticket types,
 * and this module turns those into an address on OUR public site. A general
 * "turn this string into a QR" endpoint would be a phishing kit with our name on
 * it — the same reasoning `ticketController.qrImage` carries for tickets.
 *
 * Pure (no database), so the construction is testable on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The public site's origin.
 *
 * PUBLIC_SITE_URL when it is set; otherwise the FIRST entry of FRONTEND_URL,
 * which is the CORS allowlist and therefore already names the site. Never the
 * request's Origin header — that is attacker-controlled.
 */
function siteOrigin(env = process.env) {
  const explicit = String(env.PUBLIC_SITE_URL || '').trim();
  const first = String(env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean);
  const raw = explicit || first || 'http://localhost:3000';
  const url = new URL(raw);
  return url.origin;
}

/** The event's public page. The slug is encoded, so it can only ever be a path segment. */
function eventUrl(slug, origin = siteOrigin()) {
  return `${origin}/e/${encodeURIComponent(String(slug))}`;
}

/** A deep link to one ticket type on the event page. */
function tierUrl(slug, tierId, origin = siteOrigin()) {
  const url = new URL(eventUrl(slug, origin));
  url.searchParams.set('tier', String(tierId));
  return url.toString();
}

/** `summer-gala-qr.png`, `summer-gala-vip-qr.png`. Only [a-z0-9-] ever reaches a header. */
function qrFilename(slug, tierName) {
  const parts = [slugify(slug)];
  if (tierName) parts.push(slugify(tierName, { maxLength: 40 }));
  return `${parts.join('-')}-qr.png`;
}

module.exports = { siteOrigin, eventUrl, tierUrl, qrFilename };
