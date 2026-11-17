import { toIso } from './eventTime';
import { localParts, todayAt } from './dateOnly';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "COMING SOON" EVENTS — a teaser with a month, not a time (2026-11-17).
 *
 * An organizer announces an event before it is ready to sell: a title, a city,
 * a cover and a rough date are enough to publish. Buyers see "Coming soon ·
 * March 2027" and a "Notify me" box; the organizer opens sales later.
 *
 * NO DATE COLUMN OF ITS OWN. The rough date is stored as the whole month at
 * the venue — 00:00 on the 1st to 23:59 on the last day — the way a date-only
 * listing is stored as whole days (lib/dateOnly.js), so every listing, sort
 * and "past events" cut-off keeps working. The API's `roughMonth` says whether
 * an event's dates still have that shape (backend eventRules.roughMonth).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const YM = /^(\d{4})-(\d{2})$/;

/** Is this event a coming-soon teaser? Either API's spelling. */
export function isComingSoon(event) {
  return Boolean(event?.comingSoon === true || event?.coming_soon === true);
}

/** `'YYYY-MM'` at the venue → the stored instants: the whole month there. */
export function monthRange(ym, timeZone) {
  const m = YM.exec(ym || '');
  if (!m) return { startsAt: null, endsAt: null };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { startsAt: null, endsAt: null };
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startsAt: toIso(`${m[1]}-${m[2]}-01T00:00`, timeZone),
    endsAt: toIso(`${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}T23:59`, timeZone),
  };
}

/** The month an event starts in, at the venue, as `'YYYY-MM'` — or ''. */
export function monthOf(event) {
  const day = localParts(event?.startsAt, event?.timezone)?.date;
  return day ? day.slice(0, 7) : '';
}

/** This month at the venue, `'YYYY-MM'` — the earliest a teaser may name. */
export function thisMonth(timeZone, now = new Date()) {
  return todayAt(timeZone, now).slice(0, 7);
}

/** `'2027-03'` → "March 2027". `style: 'short'` → "Mar 2027". */
export function formatYm(ym, { style = 'long' } = {}) {
  const m = YM.exec(ym || '');
  if (!m) return '';
  return new Intl.DateTimeFormat('en-US', { month: style === 'short' ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

/** "March 2027" for an event — the month it starts in, at the venue. */
export function formatMonth(event, opts) {
  return formatYm(monthOf(event), opts);
}

/** "Coming soon · March 2027", or "Coming soon" when there is no date to read. */
export function comingSoonLabel(event, opts) {
  const month = formatMonth(event, opts);
  return month ? `Coming soon · ${month}` : 'Coming soon';
}
