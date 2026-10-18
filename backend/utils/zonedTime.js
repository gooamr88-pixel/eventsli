/**
 * Wall-clock time at a venue ↔ an instant, on the server.
 *
 * The browser has had this pair for months (`frontend/src/app/lib/eventTime.js`,
 * `toIso` and `toLocalInput`) and this is a port of exactly that, two-pass
 * offset and all, because the AI draft is the first thing the SERVER has to
 * read a local time for: a model says "2026-11-07T18:30" for a Toronto event,
 * and the API has to store the instant a Toronto clock calls 6:30 pm — not the
 * one the server's own clock does.
 *
 * Kept identical in behaviour to the browser copy on purpose, so a time the
 * AI fills in and a time the organizer types into the same field resolve to
 * the same instant. Pure: no imports, testable without a database.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" in `timeZone` → ISO instant, or null if it is not one. */
function zonedToUtcIso(local, timeZone) {
  const m = LOCAL.exec(String(local || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  // Rejects 2026-02-30, which Date.UTC would quietly roll into March.
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;

  let offsetAt;
  try {
    offsetAt = (ms) => {
      const at = new Date(ms);
      return new Date(at.toLocaleString('en-US', { timeZone })).getTime()
        - new Date(at.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    };
    offsetAt(naive);
  } catch {
    return null;   // an unknown zone
  }

  // Two passes: the offset measured at the first answer lands on the right
  // side of a daylight-saving change (see the note on the browser copy).
  const first = naive - offsetAt(naive);
  return new Date(naive - offsetAt(first)).toISOString();
}

/** An instant → { local: "YYYY-MM-DDTHH:mm", weekday: 0-6 } as the venue's clock reads it. */
function localParts(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(date).map((x) => [x.type, x.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { local: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, weekday };
  } catch {
    return null;
  }
}

module.exports = { zonedToUtcIso, localParts };
