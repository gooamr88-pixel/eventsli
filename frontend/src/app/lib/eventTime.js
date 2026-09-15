/**
 * An instant → the value a `datetime-local` input shows, in the EVENT's zone.
 *
 * The inverse of `toIso` in organizer/events/new/NewEventForm.jsx. Editing an
 * event needs both directions: the stored instant is shown as the wall-clock
 * time at the venue, and whatever the organizer types is anchored back to that
 * zone — never to the browser's, or a Vancouver organizer editing a Toronto
 * show would move it three hours by opening and saving the form.
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
