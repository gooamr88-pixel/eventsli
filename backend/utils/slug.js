const crypto = require('node:crypto');

/**
 * URL slugs for public event pages.
 *
 * The slug is what search engines index and what people paste into messages, so
 * once an event is published its slug is effectively permanent — changing it
 * breaks every link already shared. `eventService` therefore only assigns one
 * on creation and never rewrites it on update.
 */

// Latin-only: the product ships in English (BRD decision), and a slug built
// from characters a URL has to percent-encode is unreadable in exactly the
// place a slug exists to be readable.
function slugify(input, { maxLength = 60 } = {}) {
  const base = String(input || '')
    .normalize('NFKD')                 // é → e +  ́
    .replace(/[̀-ͯ]/g, '')   // drop the combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');              // the slice may have left a trailing dash

  return base || 'event';
}

/**
 * A short random suffix, used only when the plain slug is taken.
 *
 * Base36 over a counter: an incrementing "-2", "-3" leaks how many events share
 * a title, and — more usefully to someone enumerating — makes neighbouring
 * slugs guessable.
 */
function suffix(bytes = 3) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * The readable alternatives to try before a random suffix, when the plain
 * slug is taken: the city, then the city and the year, then the year.
 *
 * WHY. A slug is the one part of the URL a search result shows in full, and
 * "jazz-night-toronto-2026" matches what somebody types ("jazz night toronto")
 * where "jazz-night-3fa9c1" matches nothing. Only words the slug does not
 * already contain are added, and only for NEW events — a published slug is
 * never rewritten (see the note at the top).
 */
function qualifiedSlugs(base, { city, year } = {}) {
  const has = (word) => word && `-${base}-`.includes(`-${word}-`);
  const c = city ? slugify(city, { maxLength: 30 }) : null;
  const y = year ? String(year).replace(/\D/g, '').slice(0, 4) : null;
  const cityPart = c && c !== 'event' && !has(c) ? c : null;
  const yearPart = y && y.length === 4 && !has(y) ? y : null;
  return [
    cityPart && `${base}-${cityPart}`,
    cityPart && yearPart && `${base}-${cityPart}-${yearPart}`,
    yearPart && `${base}-${yearPart}`,
  ].filter(Boolean).map((s) => s.slice(0, 90).replace(/-+$/g, ''));
}

/**
 * Finds a free slug.
 *
 * `isTaken` is injected rather than querying here so this file stays pure and
 * testable without a database. Bounded retries: after a few collisions the
 * suffix grows instead of looping, so a pathological case terminates.
 *
 * `qualifiers` ({ city, year }) are tried first, readable, before any random
 * suffix — see `qualifiedSlugs`.
 */
async function uniqueSlug(title, isTaken, { maxAttempts = 5, qualifiers = null } = {}) {
  const base = slugify(title);
  if (!(await isTaken(base))) return base;

  for (const candidate of qualifiedSlugs(base, qualifiers || {})) {
    if (!(await isTaken(candidate))) return candidate;
  }

  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = `${base}-${suffix(3 + i)}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Astronomically unlikely; a timestamp guarantees termination.
  return `${base}-${Date.now().toString(36)}`;
}

module.exports = { slugify, uniqueSlug, qualifiedSlugs };
