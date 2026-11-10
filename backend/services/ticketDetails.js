const { publicUrl } = require('./mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ticket type's details card: the photo, the line under its name, what is
 * included and what a buyer should know before paying (owner request
 * 2026-11-10). Stored whole in `ticket_tiers.details`.
 *
 * WRITTEN BY AN ORGANIZER, READ ON A PUBLIC PAGE. So every write is cleaned to
 * a fixed shape here, and nothing the client sent is kept that this file did
 * not ask for:
 *
 *   • the photo is kept as a PATH, and only a path this event's upload step
 *     could have produced; its URL is derived from that path on every read,
 *     never stored. A client-supplied URL would put any address on the page.
 *   • icons are names from a fixed list, never markup;
 *   • every string is trimmed and capped, every list is capped.
 *
 * The icon names are mirrored in the frontend's `components/tickets/
 * tierDetailIcons.js`, which draws them. A name the frontend does not know is
 * drawn as the generic check, so the two can drift without breaking a page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ICONS = Object.freeze([
  'check', 'dinner', 'drink', 'wine', 'users', 'seat', 'table', 'tag', 'shield', 'ticket',
  'star', 'crown', 'music', 'gift', 'parking', 'clock', 'door', 'camera', 'accessible', 'info',
]);

const PRICE_UNITS = Object.freeze(['person', 'ticket', 'table', 'group']);

const LIMITS = Object.freeze({
  tagline: 140,
  included: 8,
  includedTitle: 80,
  includedText: 160,
  notes: 4,
  noteText: 200,
});

function text(value, max) {
  if (typeof value !== 'string') return '';
  // Collapse runs of whitespace (a pasted menu arrives with tabs and newlines)
  // and drop control characters, then cap.
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function icon(value, fallback) {
  return ICONS.includes(value) ? value : fallback;
}

/** Is this a path this event's tier-photo upload could have produced? */
function ownTierImage(eventId, path) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `events/${eventId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^tier-[0-9a-f]{16}\.(jpg|png|webp)$/.test(path.slice(prefix.length));
}

/**
 * The stored shape, from whatever the client sent. Empty entries are dropped
 * rather than refused: a half-filled row in the editor is a row the organizer
 * has not finished, not an error worth a 400.
 */
function clean(eventId, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};

  const tagline = text(raw.tagline, LIMITS.tagline);
  if (tagline) out.tagline = tagline;

  const imagePath = raw.image && typeof raw.image === 'object' ? raw.image.path : null;
  if (ownTierImage(eventId, imagePath)) out.image = { path: imagePath };

  const included = (Array.isArray(raw.included) ? raw.included : [])
    .map((item) => ({
      icon: icon(item?.icon, 'check'),
      title: text(item?.title, LIMITS.includedTitle),
      text: text(item?.text, LIMITS.includedText),
    }))
    .filter((item) => item.title)
    .slice(0, LIMITS.included)
    .map((item) => (item.text ? item : { icon: item.icon, title: item.title }));
  if (included.length) out.included = included;

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((item) => ({ icon: icon(item?.icon, 'info'), text: text(item?.text, LIMITS.noteText) }))
    .filter((item) => item.text)
    .slice(0, LIMITS.notes);
  if (notes.length) out.notes = notes;

  if (PRICE_UNITS.includes(raw.priceUnit) && raw.priceUnit !== 'ticket') out.priceUnit = raw.priceUnit;
  if (raw.showBeforeBuying === true) out.showBeforeBuying = true;

  return out;
}

/**
 * What a reader gets: the stored shape with the photo's URL derived from its
 * path, or null when there is nothing to show. Re-checked on the way out, so
 * a row written by something other than `clean` still cannot carry a stranger's
 * image onto the page.
 *
 * The editor always gets an object (its settings matter with nothing written
 * yet); a buyer gets null when there is nothing to read, so the page offers no
 * "Details" button that opens onto an empty card.
 */
function present(eventId, stored, { forEditor = false } = {}) {
  const d = clean(eventId, stored || {});
  if (d.image) d.image = { path: d.image.path, url: publicUrl(d.image.path) };
  if (forEditor) return d;
  const hasContent = Boolean(d.tagline || d.image || d.included || d.notes);
  return hasContent ? d : null;
}

module.exports = { clean, present, ownTierImage, ICONS, PRICE_UNITS, LIMITS };
