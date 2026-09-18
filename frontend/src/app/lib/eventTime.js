/**
 * An instant → the value a `datetime-local` input shows, in the EVENT's zone.
 *
 * The inverse of `toIso`, which is now directly below it. The two lived in
 * different files for a while — this one here, its inverse exported out of a
 * 628-line component — and a pair of functions that only make sense together
 * is a pair that should be read together. Both organizer screens that edit a
 * date import both.
 *
 * Editing an event needs both directions: the stored instant is shown as the
 * wall-clock time at the venue, and whatever the organizer types is anchored
 * back to that zone — never to the browser's, or a Vancouver organizer editing
 * a Toronto show would move it three hours by opening and saving the form.
 *
 * `hourCycle: 'h23'`, not `hour12: false`: some engines render midnight as
 * "24" under the latter, which a datetime-local input rejects.
 */
export function toLocalInput(iso, timeZone) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return '';
  }
}

/**
 * `datetime-local` → ISO 8601, anchored to the EVENT's timezone.
 *
 * The input yields "2026-09-05T20:00" with no offset, and `new Date(...)` reads
 * that in the BROWSER's zone — an organizer in Vancouver scheduling a Toronto
 * show at 8pm would create it at 11pm. The offset is computed for the target
 * zone at that instant, which handles daylight saving correctly.
 *
 * The SHAPE is validated, not the parse result: V8's lenient legacy parser
 * turns junk like "not-a-date:00Z" into a real date rather than NaN.
 */
export function toIso(localValue, timeZone) {
  if (!localValue) return localValue;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(localValue)) return localValue;

  const naive = new Date(`${localValue.length === 16 ? `${localValue}:00` : localValue}Z`);
  if (Number.isNaN(naive.getTime())) return localValue;

  // The zone's offset from UTC at a given instant.
  const offsetAt = (ms) => {
    const d = new Date(ms);
    return new Date(d.toLocaleString('en-US', { timeZone })).getTime()
      - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  };

  // TWO passes. The offset used to be taken once, at the wall-clock time read
  // AS IF it were UTC — which is the wrong instant by the offset itself. Within
  // that many hours of a daylight-saving change it picked the other side of the
  // change, and the event was saved an hour off (07:00 in Chicago on the day
  // DST starts became 08:00). Re-measuring at the first answer lands on the
  // right side of the change.
  const first = naive.getTime() - offsetAt(naive.getTime());
  return new Date(naive.getTime() - offsetAt(first)).toISOString();
}

/** The browser's own zone, as a default before the organizer picks one. */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const DATE_PARTS = { month: 'short', day: 'numeric', year: 'numeric' };
const TIME_PARTS = { hour: 'numeric', minute: '2-digit' };

/**
 * An instant, as a person at the EVENT reads it — with the zone named.
 *
 * Order times, admission times, door sales and invoice due dates were printed
 * in the viewer's own zone, so an 8 pm Toronto sale read as 5 pm to an
 * organizer in Vancouver and as the next day to anyone east of the Atlantic.
 * The zone abbreviation is shown whenever a time is, so nobody has to guess
 * which clock a number is on.
 *
 * No `timeZone` means the viewer's own zone — right for the audit log, which
 * is not about any one event. `dateStyle`/`timeStyle` are not used: Intl
 * refuses to combine them with `timeZoneName`.
 */
export function formatEventTime(iso, timeZone, { date = true, time = true } = {}) {
  if (!iso) return '—';
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '—';
  const options = {
    ...(date ? DATE_PARTS : {}),
    ...(time ? { ...TIME_PARTS, timeZoneName: 'short' } : {}),
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || undefined }).format(instant);
  } catch {
    // An unknown zone name: the viewer's clock, still labelled, beats a crash.
    return new Intl.DateTimeFormat('en-US', options).format(instant);
  }
}

/**
 * A calendar date from a chart timeline — "2026-09-15" — as "Sep 15".
 *
 * The database already bucketed the sale onto the right day, so the date is
 * formatted in UTC, where midnight on it cannot slip back to the day before.
 * Three dashboard pages each carried their own copy of this.
 */
export function formatDay(isoDate) {
  if (!isoDate) return '';
  const instant = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(instant);
}
