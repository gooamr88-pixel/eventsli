/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Book a demo: the page's clock (2026-11-19).
 *
 * The API decides which starts are open (on the host's clock) and sends
 * instants. Everything here only DISPLAYS them in the zone the visitor chose:
 * which calendar day an instant falls on there, its time there, and the
 * month grid. Pure, so it is tested without a browser.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const pad = (n) => String(n).padStart(2, '0');

function parts(iso, timeZone) {
  try {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  } catch {
    return null;
  }
}

/** "YYYY-MM-DD" an instant falls on, in `timeZone`. */
export function dateIn(iso, timeZone) {
  const p = parts(iso, timeZone);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

/** { "YYYY-MM-DD": [iso, …] } in `timeZone`, each day's starts ascending. */
export function groupByDate(slots, timeZone) {
  const out = {};
  for (const iso of [...(slots || [])].sort()) {
    const d = dateIn(iso, timeZone);
    if (!d) continue;
    (out[d] ||= []).push(iso);
  }
  return out;
}

/** "5:30 PM" in `timeZone`. */
export function timeLabel(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** "5:30 PM – 6:00 PM, Mon, Nov 23, 2026" in `timeZone`. */
export function spanLabel(startIso, endIso, timeZone) {
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(startIso));
    return `${timeLabel(startIso, timeZone)} – ${timeLabel(endIso, timeZone)}, ${day}`;
  } catch {
    return '';
  }
}

/** "Monday" and "November 23, 2026" for a "YYYY-MM-DD" (a calendar date, read in UTC). */
export function dayHeading(date) {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(at),
    full: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(at),
    short: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(at),
  };
}

/** "November 2026". */
export function monthTitle(year, month) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * The month as weeks of "YYYY-MM-DD" (Sunday first), with null for the days
 * before the 1st and after the last, so every row has seven cells.
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [
    ...Array(first).fill(null),
    ...Array.from({ length: days }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The instants to ask the API for, so a month in `timeZone` is fully covered. */
export function monthRange(year, month) {
  // A day either side covers every zone from UTC-12 to UTC+14.
  return {
    from: new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString(),
    to: new Date(Date.UTC(year, month, 1) + 86_400_000).toISOString(),
  };
}

/** { year, month } after adding `delta` months. */
export function shiftMonth({ year, month }, delta) {
  const t = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
}

/** "GMT+02:00" for a zone right now; "" if the zone is unknown. */
export function offsetLabel(timeZone, at = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || '';
    return name === 'GMT' ? 'GMT+00:00' : name;
  } catch {
    return '';
  }
}

/** "Africa/Cairo (GMT+02:00)" — underscores read as spaces. */
export function zoneLabel(timeZone, at = new Date()) {
  const offset = offsetLabel(timeZone, at);
  return `${String(timeZone).replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`;
}

/** Every zone the browser knows, falling back to a short list. */
export function allZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch { /* fall through */ }
  return ['UTC', 'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Vancouver', 'Europe/London', 'Europe/Paris', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
}

/**
 * Where the card starts, on the HOST's clock: today, its month, and the last
 * bookable date. Called by the server page (it reads the clock; the card
 * must not, while rendering).
 */
export function hostCalendar(settings, now = new Date()) {
  const zone = settings?.timezone || 'UTC';
  let today;
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  const [y, m, d] = today.split('-').map(Number);
  const horizonDate = new Date(Date.UTC(y, m - 1, d + (settings?.maxDaysAhead || 30))).toISOString().slice(0, 10);
  return { today, initialMonth: { year: y, month: m }, horizonDate };
}

/** A Google Calendar "add event" link for a UTC span. */
export function googleCalendarUrl({ start, end, title, details }) {
  const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(start)}/${stamp(end)}`, ...(details ? { details } : {}) });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** The visitor's own zone, if the browser says and it is a real one. */
export function browserZone(fallback) {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (z) return z;
  } catch { /* fall through */ }
  return fallback;
}
