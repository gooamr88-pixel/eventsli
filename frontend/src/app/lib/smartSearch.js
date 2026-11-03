import { toIso } from './eventTime';
import { FALLBACK_LABELS } from './categories';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "jazz this weekend in Toronto under $40" → filters the listing understands.
 *
 * NOT A MODEL, ON PURPOSE. Search is public and unmetered: every keystroke on
 * the busiest page would be a call to a free-tier AI with a daily cap, and the
 * first crawler to hit /events?q= would spend it. So this is a deterministic
 * reader of the handful of things people actually put in an event search —
 * when, where, what kind and how much — that costs nothing, answers in
 * microseconds, and does the same thing every time.
 *
 * ONLY WHAT IS REAL IS RECOGNISED. A city counts only if it is one that has
 * events on Eventsli (`/public/cities`), and a category only if it is one of
 * the live categories. That is what stops "in Tor", typed halfway, from
 * becoming a city filter that empties the page — and stops "rock" in "Rock the
 * Boat Gala" from silently filtering to music.
 *
 * DATES ARE THE READER'S. "This weekend" means the weekend where the person is
 * searching, so the caller passes their time zone; bounds come back as
 * instants, which is what the API compares `starts_at` against.
 *
 * Whatever is left over is still searched as text, so nothing typed is lost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Words that mean a category, beyond the category's own name. Only used if that slug is live. */
const SYNONYMS = Object.freeze({
  music: ['concert', 'concerts', 'gig', 'gigs', 'live music', 'band', 'bands', 'jazz', 'rock', 'hip hop', 'rap', 'orchestra', 'symphony', 'choir', 'opera'],
  nightlife: ['party', 'parties', 'club', 'clubbing', 'nightclub', 'dj', 'rave'],
  comedy: ['stand-up', 'standup', 'stand up', 'comedian', 'improv'],
  arts: ['theatre', 'theater', 'play', 'musical', 'ballet', 'exhibition', 'gallery', 'art'],
  sports: ['game', 'match', 'tournament', 'hockey', 'basketball', 'soccer', 'football', 'baseball', 'race', 'marathon'],
  food_drink: ['food', 'dinner', 'wine', 'beer', 'tasting', 'brunch', 'cocktail', 'cocktails'],
  film: ['movie', 'movies', 'cinema', 'screening'],
  business: ['networking', 'meetup', 'summit'],
  conference: ['conference', 'conferences', 'expo', 'convention'],
  education: ['workshop', 'workshops', 'class', 'classes', 'course', 'seminar'],
  family: ['kids', 'children', 'family-friendly'],
  gala: ['gala', 'galas', 'banquet', 'ball'],
  festival: ['festival', 'festivals', 'fest'],
  wellness: ['yoga', 'meditation', 'fitness', 'wellness'],
  dance: ['dance', 'salsa', 'bachata'],
  charity: ['fundraiser', 'charity', 'benefit'],
  tech: ['hackathon', 'tech', 'gaming', 'esports'],
  faith: ['church', 'worship', 'prayer'],
  holiday: ['christmas', 'halloween', 'new year', "new year's", 'diwali', 'eid', 'thanksgiving'],
});

/**
 * GENRES narrow within a category ("jazz" is music, but not all music is jazz),
 * so they are also kept as text to search for. Every other category word IS
 * the category ("gala", "festival", "concert") and is taken out — searching
 * the text for it as well would hide a gala titled "Spring Banquet".
 */
const GENRES = new Set(['jazz', 'rock', 'hip hop', 'rap', 'orchestra', 'symphony', 'choir', 'opera', 'hockey', 'basketball',
  'soccer', 'football', 'baseball', 'marathon', 'wine', 'beer', 'brunch', 'tasting', 'cocktail', 'cocktails', 'salsa',
  'bachata', 'yoga', 'meditation', 'ballet', 'musical', 'improv', 'christmas', 'halloween', 'new year', "new year's",
  'diwali', 'eid', 'thanksgiving', 'hackathon', 'esports', 'gaming', 'dj', 'rave']);

/** Words that carry no search meaning once the filters are taken out. */
const FILLER = new Set(['events', 'event', 'tickets', 'ticket', 'things', 'to', 'do', 'shows', 'show', 'in', 'near',
  'on', 'at', 'for', 'the', 'a', 'an', 'and', 'this', 'next', 'what', "what's", 'whats', 'happening', 'around', 'me', 'nearby',
  'with', 'of', 'cheap', 'best', 'top', 'good', 'fun', 'something']);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pad = (n) => String(n).padStart(2, '0');

/** Today's calendar date and weekday where the reader is. */
function localToday(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

/** A calendar date plus `days`, as y/m/d (no time zone involved — it is a date). */
function addDays({ y, m, d }, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const midnight = (date, timeZone) => toIso(`${date.y}-${pad(date.m)}-${pad(date.d)}T00:00`, timeZone);
const range = (start, endExclusive, timeZone) => ({ from: midnight(start, timeZone), to: midnight(endExclusive, timeZone) });

/** Each date phrase, its pattern, its label, and the range it means. */
function datePhrases(now, timeZone) {
  const today = localToday(now, timeZone);
  const t = { y: today.y, m: today.m, d: today.d };
  // The weekend in progress counts as "this weekend" (see QuickFilters.weekendRange).
  const toFriday = today.dow === 0 ? -2 : today.dow === 6 ? -1 : 5 - today.dow;
  const friday = addDays(t, toFriday);
  const toMonday = ((8 - today.dow) % 7) || 7;
  const firstNext = today.m === 12 ? { y: today.y + 1, m: 1, d: 1 } : { y: today.y, m: today.m + 1, d: 1 };
  const firstAfter = firstNext.m === 12 ? { y: firstNext.y + 1, m: 1, d: 1 } : { y: firstNext.y, m: firstNext.m + 1, d: 1 };

  const phrases = [
    ['next weekend', 'Next weekend', range(addDays(friday, 7), addDays(friday, 10), timeZone)],
    ['this weekend|the weekend|weekend', 'This weekend', range(friday, addDays(friday, 3), timeZone)],
    ['next week', 'Next week', range(addDays(t, toMonday), addDays(t, toMonday + 7), timeZone)],
    ['this week', 'This week', range(t, addDays(t, toMonday), timeZone)],
    ['next month', 'Next month', range(firstNext, firstAfter, timeZone)],
    ['this month', 'This month', range(t, firstNext, timeZone)],
    ['tonight', 'Tonight', { from: now.toISOString(), to: midnight(addDays(t, 1), timeZone) }],
    ['today', 'Today', range(t, addDays(t, 1), timeZone)],
    ['tomorrow', 'Tomorrow', range(addDays(t, 1), addDays(t, 2), timeZone)],
  ];

  DAYS.forEach((day, i) => {
    const ahead = (i - today.dow + 7) % 7;
    const date = addDays(t, ahead);
    phrases.push([`(?:on\\s+)?${day}s?(?:\\s+night)?`, day[0].toUpperCase() + day.slice(1), range(date, addDays(date, 1), timeZone)]);
  });

  MONTHS.forEach((month, i) => {
    const m = i + 1;
    const year = m < today.m ? today.y + 1 : today.y;
    const name = month[0].toUpperCase() + month.slice(1);
    // "december 12", "dec 12th" — one day. Checked before the bare month.
    phrases.push([`${month.slice(0, 3)}(?:${month.slice(3)})?\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?`, null, (day) => {
      const n = Number(day);
      if (n < 1 || n > 31) return null;
      const y = m < today.m || (m === today.m && n < today.d) ? today.y + 1 : today.y;
      const date = { y, m, d: n };
      return { label: `${name} ${n}`, ...range(date, addDays(date, 1), timeZone) };
    }]);
    // "in december" — the month, from today if it is this month. "may" alone is a verb.
    if (month !== 'may' && month !== 'march') {
      const start = m === today.m ? t : { y: year, m, d: 1 };
      const end = m === 12 ? { y: year + 1, m: 1, d: 1 } : { y: year, m: m + 1, d: 1 };
      phrases.push([`(?:in\\s+)?${month}`, name, range(start, end, timeZone)]);
    }
  });
  return phrases;
}

/**
 * @param {string} input
 * @param {object} ctx  `{ now, timeZone, cities: string[], categories: [{slug,label}] }`
 * @returns {{ keywords: string, city: string|null, category: string|null, from: string|null,
 *             to: string|null, maxPriceCents: number|null, understood: {key,label,phrase}[] }}
 */
export function parseSearch(input, { now = new Date(), timeZone = 'America/Toronto', cities = [], categories = [] } = {}) {
  let rest = ` ${String(input || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()} `;
  const understood = [];
  const out = { keywords: '', city: null, category: null, from: null, to: null, maxPriceCents: null, understood };
  const take = (re) => {
    const m = rest.match(re);
    if (!m) return null;
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };

  // How much.
  const price = take(/\s(?:under|below|less than|max|up to|cheaper than|<)\s*\$?\s*(\d{1,5})(?:\.\d{1,2})?\s*(?:\$|dollars?|bucks|cad|usd)?(?=\s)/);
  if (price) {
    out.maxPriceCents = Number(price[1]) * 100;
    understood.push({ key: 'price', label: `Under $${price[1]}`, phrase: price[0].trim() });
  } else if (take(/\s(?:free|no cost)(?=\s)/)) {
    out.maxPriceCents = 0;
    understood.push({ key: 'price', label: 'Free', phrase: 'free' });
  }

  // When.
  for (const [pattern, label, value] of datePhrases(now, timeZone)) {
    const m = take(new RegExp(`\\s(?:${pattern})(?=\\s)`));
    if (!m) continue;
    const r = typeof value === 'function' ? value(m[1]) : { label, ...value };
    if (!r) continue;
    Object.assign(out, { from: r.from, to: r.to });
    understood.push({ key: 'date', label: r.label || label, phrase: m[0].trim() });
    break;
  }

  // Where — only a city that has events, longest name first ("New York" before "York").
  const known = [...new Set(cities.map((c) => String(c).trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const city of known) {
    const m = take(new RegExp(`\\s(?:(?:in|near|around)\\s+)?${escape(city.toLowerCase())}(?=\\s)`));
    if (m) {
      out.city = city;
      understood.push({ key: 'city', label: `In ${city}`, phrase: m[0].trim() });
      break;
    }
  }

  // What kind — the live categories, by name or by a synonym.
  const live = new Map(categories.map((c) => [c.slug, c.label || FALLBACK_LABELS[c.slug] || c.slug]));
  const words = [];
  for (const [slug, label] of live) {
    words.push([String(label).toLowerCase().replace(/\s*&\s*/g, ' and '), slug], [String(label).toLowerCase(), slug]);
    (SYNONYMS[slug] || []).forEach((w) => words.push([w, slug]));
  }
  words.sort((a, b) => b[0].length - a[0].length);
  for (const [word, slug] of words) {
    const m = rest.match(new RegExp(`\\s${escape(word)}(?=\\s)`));
    if (!m) continue;
    out.category = slug;
    understood.push({ key: 'category', label: live.get(slug), phrase: word });
    // A genre ("jazz") is also what the person wants to see, so it stays in
    // the text search; any other category word is the category itself.
    if (!GENRES.has(word)) take(new RegExp(`\\s${escape(word)}(?=\\s)`));
    break;
  }

  out.keywords = rest.split(' ').filter((w) => w && !FILLER.has(w)).join(' ').trim();
  return out;
}

/** The query with one recognised phrase taken out — for the "×" on its chip. */
export function withoutPhrase(input, phrase) {
  const re = new RegExp(`(^|\\s)${escape(phrase)}(?=\\s|$)`, 'i');
  return String(input || '').replace(re, ' ').replace(/\s+/g, ' ').trim();
}

/** A time zone the reader's browser named, or the default. Never trusted beyond this. */
export function safeTimeZone(value, fallback = 'America/Toronto') {
  try {
    if (!value) return fallback;
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) }).format(0);
    return String(value);
  } catch {
    return fallback;
  }
}
