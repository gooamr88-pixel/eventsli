import { toIso } from './eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATE-ONLY LISTINGS — display-only events have a date, not a time.
 *
 * A display-only event is a listing: nothing is sold, nobody is scanned at a
 * door, and the organizer often knows only the day ("Saturday, May 16") or the
 * days ("May 16 – 18"). Asking them for a start and end TIME made them invent
 * one, and the public page then stated that invention as a fact.
 *
 * NO NEW COLUMN. `starts_at` and `ends_at` are timestamps and stay required
 * (the listing, "near me", the sitemap and the "past events" cut-off all sort
 * and filter on them). A date-only listing is stored as the whole day(s) at the
 * venue — 00:00 on the first day to 23:59 on the last — and THAT shape, on a
 * display-only event, is what every screen reads as "date only" (`isDateOnly`).
 * A schema change was the alternative, and this project has shipped code ahead
 * of its migrations before (AI-ISSUES-LOG I-003); this needs none.
 *
 * Ticketed events are never date-only: a ticket is for a time, at a door.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const END_OF_DAY = '23:59';

/** `YYYY-MM-DD` dates at the venue → the stored instants. `last` defaults to `first`. */
export function dateOnlyRange(first, last, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first || '')) return { startsAt: null, endsAt: null };
  const end = /^\d{4}-\d{2}-\d{2}$/.test(last || '') && last >= first ? last : first;
  return { startsAt: toIso(`${first}T00:00`, timeZone), endsAt: toIso(`${end}T${END_OF_DAY}`, timeZone) };
}

/** The venue's wall clock for an instant: `{ date: 'YYYY-MM-DD', time: 'HH:mm' }`. */
export function localParts(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return null;
  }
}

const displayOnly = (event) => Boolean(event?.displayOnly || event?.listingType === 'display_only' || event?.listing_type === 'display_only');

/** Is this a date-only listing? Display-only, from 00:00 on its first day to 23:59 on its last. */
export function isDateOnly(event) {
  if (!displayOnly(event) || !event?.startsAt || !event?.endsAt) return false;
  const tz = event.timezone;
  const s = localParts(event.startsAt, tz);
  const e = localParts(event.endsAt, tz);
  return Boolean(s && e && s.time === '00:00' && e.time === END_OF_DAY);
}

/** The first and last day of a date-only listing, as `YYYY-MM-DD`. */
export function dateOnlyDays(event) {
  return {
    first: localParts(event.startsAt, event.timezone)?.date || '',
    last: localParts(event.endsAt, event.timezone)?.date || '',
  };
}

const fmtDay = (ymd, opts) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
};

/**
 * "Saturday, May 16, 2026" for one day; "May 16 – 18, 2026",
 * "May 30 – June 2, 2026" or "Dec 30, 2026 – Jan 2, 2027" for
 * several. `style: 'short'` drops the weekday and the year.
 *
 * Built from parts, not one Intl call: Intl given only a day and a year prints
 * "2026 (day: 18)", which is how the first version of this read.
 */
export function formatDateOnly(event, { style = 'long' } = {}) {
  const { first, last } = dateOnlyDays(event);
  if (!first) return '';
  const long = style === 'long';
  if (!last || last === first) {
    return fmtDay(first, long
      ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const month = (ymd) => fmtDay(ymd, { month: long ? 'long' : 'short' });
  const [y1, , d1] = first.split('-').map(Number);
  const [y2, , d2] = last.split('-').map(Number);
  const year = (y) => (long ? `, ${y}` : '');
  if (y1 !== y2) return `${month(first)} ${d1}, ${y1} – ${month(last)} ${d2}, ${y2}`;
  if (first.slice(5, 7) === last.slice(5, 7)) return `${month(first)} ${d1} – ${d2}${year(y1)}`;
  return `${month(first)} ${d1} – ${month(last)} ${d2}${year(y1)}`;
}

/** Today's date at the venue, `YYYY-MM-DD` — "in the future" for a date means today or later. */
export function todayAt(timeZone, now = new Date()) {
  return localParts(now.toISOString(), timeZone)?.date || now.toISOString().slice(0, 10);
}
