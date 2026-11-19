const { zonedToUtcIso, localParts } = require('../../utils/zonedTime');
const { DAYS, minutes } = require('./demoSettings');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Which demo start times are open (owner, 2026-11-19).
 *
 * Everything is reckoned on the HOST's clock (`settings.timezone`): "Monday
 * 9 to 5" means 9 to 5 where the team is, whatever zone the visitor views the
 * page in. The page converts the instants this returns into the visitor's
 * chosen zone; it never works out availability itself.
 *
 * A start is open when:
 *   - its host day is not blocked and has a window that holds the whole demo
 *   - it is at least `minNoticeHours` away, and within `maxDaysAhead` days
 *   - fewer than `capacity` live bookings overlap it, each padded by
 *     `bufferMinutes` on both sides
 *   - with a `dailyLimit`, its host day holds fewer bookings than the limit
 *
 * The database re-checks the last two inside a lock when someone books
 * (book_demo), so this is the menu, not the guarantee.
 *
 * Pure: settings, bookings and `now` come in, instants go out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** "YYYY-MM-DD" + n days, on the calendar (no clock involved). */
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The instants a host day starts and ends at — for the daily limit. */
function hostDayBounds(date, timezone) {
  return {
    start: zonedToUtcIso(`${date}T00:00`, timezone),
    end: zonedToUtcIso(`${addDays(date, 1)}T00:00`, timezone),
  };
}

/** The host's calendar date an instant falls on. */
function hostDate(iso, timezone) {
  const parts = localParts(iso, timezone);
  return parts ? parts.local.slice(0, 10) : null;
}

/**
 * @param {object} settings  cleaned (demoSettings.clean)
 * @param {Array<{startsAt, endsAt}>} bookings  LIVE bookings around the range
 * @param {object} o
 * @param {Date|number} o.now
 * @param {string} [o.from]  ISO; defaults to now
 * @param {string} [o.to]    ISO; capped at the booking horizon
 * @returns {string[]} ISO start instants, ascending
 */
function openSlots(settings, bookings, { now = Date.now(), from, to } = {}) {
  const s = settings;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const earliest = Math.max(nowMs + s.minNoticeHours * 3_600_000, from ? Date.parse(from) : nowMs);
  const today = hostDate(new Date(nowMs).toISOString(), s.timezone);
  const lastDay = addDays(today, s.maxDaysAhead);
  const latest = Math.min(
    to ? Date.parse(to) : Infinity,
    Date.parse(hostDayBounds(lastDay, s.timezone).end),
  );
  if (!(earliest < latest)) return [];

  const blocked = new Set(s.blockedDates);
  const durMs = s.durationMinutes * 60_000;
  const bufMs = s.bufferMinutes * 60_000;
  const live = bookings
    .map((b) => ({ start: Date.parse(b.startsAt), end: Date.parse(b.endsAt) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  const perDay = new Map();
  for (const b of live) {
    const day = hostDate(new Date(b.start).toISOString(), s.timezone);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }

  const out = [];
  const firstDay = hostDate(new Date(earliest).toISOString(), s.timezone);
  // Walk host days; a range never spans more than the horizon (≤ 366 days).
  for (let day = firstDay, guard = 0; day <= lastDay && guard < 400; day = addDays(day, 1), guard += 1) {
    if (blocked.has(day)) continue;
    if (s.dailyLimit > 0 && (perDay.get(day) || 0) >= s.dailyLimit) continue;
    const windows = s.weeklyHours[DAYS[weekdayOf(day)]] || [];
    for (const [a, b] of windows) {
      const open = minutes(a);
      const close = minutes(b);
      for (let m = open; m + s.durationMinutes <= close; m += s.intervalMinutes) {
        const iso = zonedToUtcIso(`${day}T${hhmm(m)}`, s.timezone);
        if (!iso) continue;
        const start = Date.parse(iso);
        // A wall-clock time skipped by a daylight-saving change resolves to a
        // different hour; it is not a time the host's clock shows, so skip it.
        if (hostDate(iso, s.timezone) !== day || localParts(iso, s.timezone).local.slice(11) !== hhmm(m)) continue;
        if (start < earliest || start >= latest) continue;
        const end = start + durMs;
        const overlapping = live.filter((x) => x.start < end + bufMs && x.end + bufMs > start).length;
        if (overlapping >= s.capacity) continue;
        out.push(new Date(start).toISOString());
      }
    }
  }
  return [...new Set(out)].sort();
}

/** Is this exact instant one of the open starts? (Used before booking.) */
function isOpen(settings, bookings, iso, { now = Date.now() } = {}) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const exact = new Date(t).toISOString();
  return openSlots(settings, bookings, {
    now, from: new Date(t - 1000).toISOString(), to: new Date(t + 1000).toISOString(),
  }).includes(exact);
}

module.exports = { openSlots, isOpen, hostDayBounds, hostDate, addDays, DAY_MS };
