/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What a model said, reduced to what the organizer actually wrote.
 *
 * Pure and import-light, like `eventRules.js`: these are the rules that stop
 * an invented venue, date or price reaching a draft, and they have to be
 * testable without a network, a key or a database.
 *
 * EVERY FACT MUST QUOTE THE ORGANIZER. A start time, an end time, a venue, an
 * address, a city, a ticket price, a quantity, a schedule time, a room — each
 * arrives with `evidence`, the words the model says it read it from. Kept only
 * when:
 *
 *   1. the evidence appears in the organizer's (redacted) text, and
 *   2. the value is what the evidence says — the venue name inside the quote,
 *      the price's amount in the quote, the hour in the quote, the weekday and
 *      month in the quote agreeing with the date.
 *
 * Anything else becomes null, and the organizer sees "needs you" instead of a
 * confident wrong answer. A dropped fact costs them a field; a kept invention
 * costs a buyer a wasted trip.
 *
 * PRICES ARE THE STRICTEST (D-006, D-012). An amount must sit next to a
 * currency mark in the quote — "$95", "95 CAD" — because a bare number in
 * "tables of 10" is not a price. A different currency (€, £) is dropped rather
 * than converted. Zero is kept only when the quote says "free".
 *
 * WRITTEN COPY (title, description, highlights) cannot be proven, so it is
 * labelled "suggested" in the interface and bounded here: links and money the
 * organizer never wrote are cut out of it, and a highlight that shares no
 * word with the description is dropped as made up.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { zonedToUtcIso } = require('../../utils/zonedTime');
const { TIER_KINDS, ADMISSION, PURCHASE, LIMITS } = require('./eventDraftPrompt');

const MAX = Object.freeze({
  title: 200, description: 3000, venueName: 200, venueAddress: 300, city: 120,
  highlight: 120, tierName: 80, tierDescription: 500, scheduleTitle: 160, location: 120, evidence: 300,
});
const MAX_PRICE = 100000;          // $100,000 a ticket: past this it is a typo
const MAX_QUANTITY = 100000;
const HORIZON_MS = 2 * 365 * 24 * 3600 * 1000;
const MAX_LENGTH_MS = 31 * 24 * 3600 * 1000;

function invalid(message) {
  return Object.assign(new Error(message), { code: 'AI_OUTPUT_INVALID' });
}

/** Comparison form: lower case, one kind of quote and dash, single spaces. */
function norm(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Display form: no control characters, single spaces, at most `max` characters. */
function clean(value, max) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let out = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length > max) {
    const cut = out.slice(0, max);
    const space = cut.lastIndexOf(' ');
    out = (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
  }
  return out || null;
}

/** A quote that really is in the text, or null. */
function quoted(evidence, text) {
  const e = clean(evidence, MAX.evidence);
  if (!e || e.length < 2) return null;
  return norm(text).includes(norm(e)) ? e : null;
}

// ─── Times and dates ───────────────────────────────────────────────────────
/**
 * Month and day names, matched WITHOUT false friends. A bare `may` is "people
 * may bring", `march` is a verb and `sun` is in "sunset", so those — and every
 * abbreviation — count only beside a day number ("May 7", "7 Mar", "Sat.").
 * A wrong match here does not invent anything; it drops a correct date, which
 * is the cheaper mistake, but still one worth not making.
 */
const MONTHS = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may', 'may'], ['june', 'jun'],
  ['july', 'jul'], ['august', 'aug'], ['september', 'sept?'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec'],
];
const AMBIGUOUS_MONTHS = new Set(['march', 'may']);
const DAYS = [
  ['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tues?'], ['wednesday', 'wed'],
  ['thursday', 'thu(?:rs?)?'], ['friday', 'fri'], ['saturday', 'sat'],
];

const TIME_TOKEN = new RegExp([
  /\b(noon|midnight)\b/.source,
  /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.source,
  /\b(\d{1,2}):(\d{2})\b/.source,
  /\b(\d{1,2})h(\d{2})?\b/.source,
  // "awards at 9", "from 10": an hour after a time preposition, nothing else.
  /\b(?:at|from|until|till|to)\s+(\d{1,2})(?![\d:]|\s*(?:st|nd|rd|th|people|guests|tables?|seats?|%))\b/.source,
].join('|'), 'gi');

/** Every minute-of-day the quote could mean. "6:30" or "at 9" without am/pm is both. */
function timesIn(evidence) {
  const out = new Set();
  const both = (h, mi) => {
    if (h > 23 || mi > 59) return;
    out.add(h * 60 + mi);
    if (h >= 1 && h <= 11) out.add((h + 12) * 60 + mi);   // "dinner 7:30" is evening
  };
  for (const m of norm(evidence).matchAll(TIME_TOKEN)) {
    if (m[1]) out.add(m[1] === 'noon' ? 720 : 0);
    else if (m[2]) {
      const h = (Number(m[2]) % 12) + (/^p/.test(m[4]) ? 12 : 0);
      out.add(h * 60 + Number(m[3] || 0));
    } else if (m[5]) both(Number(m[5]), Number(m[6]));
    else if (m[7]) both(Number(m[7]), Number(m[8] || 0));
    else if (m[9]) both(Number(m[9]), 0);
  }
  return out;
}

function monthsNamed(words) {
  const found = [];
  MONTHS.forEach(([full, abbr], i) => {
    const beside = new RegExp(`\\b(?:${full}|${abbr})\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${full}|${abbr})\\b`);
    const alone = !AMBIGUOUS_MONTHS.has(full) && new RegExp(`\\b${full}\\b`).test(words);
    if (alone || beside.test(words)) found.push(i + 1);
  });
  return found;
}

function daysNamed(words) {
  const found = [];
  DAYS.forEach(([full, abbr], i) => {
    if (new RegExp(`\\b${full}\\b|\\b${abbr}\\.|\\b${abbr},`).test(words)) found.push(i);
  });
  return found;
}

/** Does the date the model chose agree with any weekday, month and day the quote names? */
function dateAgrees(local, evidence) {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const words = norm(evidence);

  const days = daysNamed(words);
  if (days.length && !days.includes(weekday)) return false;

  const months = monthsNamed(words);
  if (months.length && !months.includes(mo)) return false;
  if (months.includes(mo)) {
    // The number written right beside THIS month is the day: "November 7",
    // "7 Nov", "Nov. 7th", "the 7th of November". Any other number in the
    // quote (a time, a table size) is not consulted.
    const [full, abbr] = MONTHS[mo - 1];
    const name = `(?:${full}|${abbr})`;
    const beside = [...words.matchAll(new RegExp(
      `\\b${name}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${name}\\b`, 'g',
    ))].map((x) => Number(x[1] || x[2]));
    if (beside.length && !beside.includes(d)) return false;
  }
  return true;
}

/**
 * One time fact. `{ at, local, evidence, note }` — `at` is the instant, null
 * when the time cannot be trusted. `note` says why, for the "needs you" row.
 */
function timeFact(raw, { text, timezone }) {
  const evidence = quoted(raw?.evidence, text);
  const local = typeof raw?.value === 'string' ? raw.value.trim().slice(0, 16) : null;
  const missing = (note) => ({ at: null, local: null, evidence, note });

  if (!evidence) return missing(local ? 'NOT_IN_TEXT' : null);
  if (!local) return missing(timesIn(evidence).size ? null : 'DATE_WITHOUT_TIME');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return missing('UNREADABLE');

  const minutes = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  const times = timesIn(evidence);
  if (!times.size) return missing('DATE_WITHOUT_TIME');
  if (!times.has(minutes)) return missing('TIME_MISMATCH');
  if (!dateAgrees(local, evidence)) return missing('DATE_MISMATCH');

  const at = zonedToUtcIso(local, timezone);
  if (!at) return missing('UNREADABLE');
  return { at, local, evidence, note: null };
}

function shiftDay(local) {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return `${next.toISOString().slice(0, 10)}${local.slice(10)}`;
}

/** Start and end, checked against each other and against the calendar. */
function eventTimes(raw, ctx) {
  const starts = timeFact(raw.starts, ctx);
  let ends = timeFact(raw.ends, ctx);
  const now = ctx.now.getTime();

  if (starts.at) {
    const t = new Date(starts.at).getTime();
    if (t <= now) Object.assign(starts, { at: null, local: null, note: 'IN_THE_PAST' });
    else if (t > now + HORIZON_MS) Object.assign(starts, { at: null, local: null, note: 'TOO_FAR' });
  }
  if (starts.at && ends.at && new Date(ends.at) <= new Date(starts.at)) {
    // "6:30pm to 1am": the model kept the start's date. Move the end to the
    // next day when that makes a plausible evening.
    const next = zonedToUtcIso(shiftDay(ends.local), ctx.timezone);
    const gap = next ? new Date(next) - new Date(starts.at) : -1;
    ends = gap > 0 && gap <= 18 * 3600 * 1000
      ? { ...ends, at: next, local: shiftDay(ends.local) }
      : { ...ends, at: null, local: null, note: 'ENDS_BEFORE_START' };
  }
  if (ends.at && !starts.at) Object.assign(ends, { at: null, local: null, note: 'NO_START' });
  if (starts.at && ends.at && new Date(ends.at) - new Date(starts.at) > MAX_LENGTH_MS) {
    Object.assign(ends, { at: null, local: null, note: 'TOO_LONG' });
  }
  return { starts, ends };
}

// ─── Places ────────────────────────────────────────────────────────────────
/** A venue, address or city: the value must be inside a quote that is inside the text. */
function placeFact(raw, max, text) {
  const value = clean(raw?.value, max);
  const evidence = quoted(raw?.evidence, text);
  if (!value || !evidence || !norm(evidence).includes(norm(value))) {
    return { value: null, evidence: null, dropped: Boolean(value) };
  }
  return { value, evidence, dropped: false };
}

// ─── Money ─────────────────────────────────────────────────────────────────
const MONEY = /(?:c\$|us\$|\$|cad|usd)\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)|(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:\$|cad|usd|dollars?\b)/gi;
const OTHER_CURRENCY = /[€£¥₹]|\b(eur|gbp|euros?|pounds?)\b/i;

function amountsIn(value) {
  return [...String(value || '').matchAll(MONEY)]
    .map((m) => Number(String(m[1] || m[2]).replace(/,/g, '')))
    .filter(Number.isFinite);
}

/** Integer cents, or null. See the note at the top on why this is strict. */
function priceFact(price, rawEvidence, text) {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return { cents: null, evidence: null };
  const n = Number(price);
  const evidence = quoted(rawEvidence, text);
  if (!evidence || n < 0 || n > MAX_PRICE || OTHER_CURRENCY.test(evidence)) return { cents: null, evidence: null };
  if (n === 0) return /\bfree\b/i.test(evidence) ? { cents: 0, evidence } : { cents: null, evidence: null };
  if (!amountsIn(evidence).some((a) => Math.abs(a - n) < 0.005)) return { cents: null, evidence: null };
  return { cents: Math.round(n * 100), evidence };
}

function quantityFact(quantity, rawEvidence, text) {
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) return { quantity: null, evidence: null };
  const evidence = quoted(rawEvidence, text);
  const digits = norm(evidence).replace(/,/g, '');
  if (!evidence || !new RegExp(`\\b${n}\\b`).test(digits)) return { quantity: null, evidence: null };
  return { quantity: n, evidence };
}

// ─── Written copy ──────────────────────────────────────────────────────────
const STOP = new Set(['with', 'from', 'that', 'this', 'your', 'have', 'will', 'their', 'there', 'about', 'into', 'more',
  'event', 'night', 'evening', 'what', 'when', 'where', 'them', 'they', 'also', 'just', 'each', 'very', 'come', 'join']);
const words = (value) => new Set(norm(value).match(/[a-zÀ-ɏ]{4,}/g)?.filter((w) => !STOP.has(w)) || []);

/** Cut links, contacts and amounts the organizer never wrote out of AI copy. */
function scrubCopy(value, text, max) {
  let out = clean(value, max * 2);
  if (!out) return null;
  const source = norm(text);
  out = out.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, (url) => (source.includes(norm(url)) ? url : ''));
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '');
  const known = new Set(amountsIn(text).map(String));
  // A sentence that quotes a price the organizer did not give goes entirely.
  out = out.split(/(?<=[.!?])\s+/)
    .filter((sentence) => amountsIn(sentence).every((a) => known.has(String(a))))
    .join(' ');
  return clean(out, max);
}

function highlightsFrom(raw, text) {
  const source = words(text);
  const seen = new Set();
  const out = [];
  for (const h of Array.isArray(raw) ? raw : []) {
    const value = scrubCopy(h, text, MAX.highlight);
    if (!value || seen.has(norm(value))) continue;
    if (![...words(value)].some((w) => source.has(w))) continue;   // shares nothing with the text
    seen.add(norm(value));
    out.push(value);
    if (out.length === LIMITS.highlights) break;
  }
  return out;
}

// ─── Ticket types and schedule ─────────────────────────────────────────────
function tiersFrom(raw, { text, listingType, admissionType }) {
  if (listingType === 'display_only') return [];
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const name = clean(t?.name, MAX.tierName);
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const price = priceFact(t.price, t.priceEvidence, text);
    // Quantity only means something without a seat map: on reserved seating
    // the map decides how many exist.
    const qty = admissionType === 'general'
      ? quantityFact(t.quantity, t.quantityEvidence, text) : { quantity: null, evidence: null };
    out.push({
      name,
      kind: TIER_KINDS.includes(t.kind) ? t.kind : 'standard',
      description: scrubCopy(t.description, text, MAX.tierDescription),
      quantity: qty.quantity,
      quantityEvidence: qty.evidence,
      priceCents: price.cents,
      priceEvidence: price.evidence,
    });
    if (out.length === LIMITS.tiers) break;
  }
  return out;
}

function scheduleFrom(raw, ctx, eventStart) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const title = clean(item?.title, MAX.scheduleTitle);
    if (!title) continue;
    const time = timeFact({ value: item.startsLocal, evidence: item.timeEvidence }, ctx);
    // A running-order time belongs near the event. A model that put "doors"
    // on a different week has guessed the date, not read it.
    if (time.at && eventStart && Math.abs(new Date(time.at) - new Date(eventStart)) > 2 * 24 * 3600 * 1000) {
      Object.assign(time, { at: null, local: null, note: 'DATE_MISMATCH' });
    }
    const location = placeFact({ value: item.location, evidence: item.locationEvidence }, MAX.location, ctx.text);
    out.push({
      title,
      startsAt: time.at,
      local: time.local,
      evidence: time.at ? time.evidence : null,
      location: location.value,
      locationEvidence: location.evidence,
    });
    if (out.length === LIMITS.schedule) break;
  }
  return out;
}

/**
 * The whole answer → a draft the interface can show and the API can save.
 *
 * @param {object} raw   the provider's parsed JSON
 * @param {object} ctx   { text (redacted), listingType, timezone, categories: slug[], now }
 * @throws AI_OUTPUT_INVALID when there is nothing usable (not an object, no title)
 */
function validateDraft(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('The answer was not an object.');
  const c = { ...ctx, now: ctx.now || new Date() };
  const title = scrubCopy(raw.title, c.text, MAX.title);
  if (!title || title.length < 3) throw invalid('The answer had no usable title.');

  const ticketed = c.listingType !== 'display_only';
  const admissionType = ticketed ? (ADMISSION.includes(raw.admissionType) ? raw.admissionType : 'general') : null;
  const purchaseMode = admissionType === 'reserved'
    ? (PURCHASE.includes(raw.purchaseMode) ? raw.purchaseMode : 'seat_only') : (ticketed ? 'seat_only' : null);

  const { starts, ends } = eventTimes(raw, c);
  const venueName = placeFact(raw.venueName, MAX.venueName, c.text);
  const venueAddress = placeFact(raw.venueAddress, MAX.venueAddress, c.text);
  const city = placeFact(raw.city, MAX.city, c.text);

  const draft = {
    listingType: ticketed ? 'ticketed' : 'display_only',
    title,
    category: c.categories.includes(raw.category) ? raw.category : 'other',
    description: scrubCopy(raw.description, c.text, MAX.description),
    startsAt: starts,
    endsAt: ends,
    venueName: { value: venueName.value, evidence: venueName.evidence },
    venueAddress: { value: venueAddress.value, evidence: venueAddress.evidence },
    city: { value: city.value, evidence: city.evidence },
    admissionType,
    purchaseMode,
    highlights: highlightsFrom(raw.highlights, c.text),
    tiers: tiersFrom(raw.tiers, { text: c.text, listingType: c.listingType, admissionType }),
    schedule: scheduleFrom(raw.schedule, c, starts.at),
  };

  // How much was thrown away — logged as a number, never the content.
  const dropped = [starts, ends].filter((f) => f.note && f.note !== 'DATE_WITHOUT_TIME').length
    + [venueName, venueAddress, city].filter((f) => f.dropped).length
    + (Array.isArray(raw.tiers) ? raw.tiers.filter((t) => t?.price !== null && t?.price !== undefined).length : 0)
    - draft.tiers.filter((t) => t.priceCents !== null).length;

  return { draft, dropped: Math.max(0, dropped) };
}

module.exports = {
  validateDraft, norm, quoted, timesIn, dateAgrees, priceFact, quantityFact, amountsIn, scrubCopy, highlightsFrom, MAX,
};
