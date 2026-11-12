/**
 * Quiet hours, in the RECIPIENT's local time.
 *
 * A promotion sent at 2pm Toronto time lands at 9pm in Cairo. The window comes
 * from the country (or the platform default) and is read in the country's
 * representative time zone; countries spanning several zones use the most
 * populous one, which is the honest limit of knowing only a phone number.
 */

function localTime(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { hour: get('hour') % 24, minute: get('minute') };
  } catch {
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

function isQuiet(hour, start, end) {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The moment the window ends, or null when it is not quiet now. */
function quietUntil(now, timeZone, start, end) {
  const { hour, minute } = localTime(now, timeZone);
  if (!isQuiet(hour, start, end)) return null;
  const hours = (end - hour + 24) % 24 || 24;
  return new Date(now.getTime() + hours * 3_600_000 - minute * 60_000 + 60_000);
}

module.exports = { localTime, isQuiet, quietUntil };
