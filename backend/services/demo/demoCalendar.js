/**
 * "Add to calendar" for a booked demo: an .ics file and a Google Calendar
 * link. Pure; the instants are UTC so neither needs a zone table.
 */

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 text: backslash, semicolon, comma and newline escaped; lines folded at 75 octets. */
function esc(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * @param {object} o
 * @param {string} o.uid       stable per booking, so a re-download updates the same entry
 * @param {number} [o.sequence] bumped on every reschedule
 * @param {boolean} [o.cancelled]
 */
function buildIcs({ uid, sequence = 0, start, end, title, description, location, url, cancelled = false }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Eventsli//Demo booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${esc(uid)}@eventsli.com`,
    `SEQUENCE:${Number(sequence) || 0}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    url ? `URL:${esc(url)}` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function googleCalendarUrl({ start, end, title, details, location }) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${stamp(start)}/${stamp(end)}`,
    ...(details ? { details } : {}),
    ...(location ? { location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

module.exports = { buildIcs, googleCalendarUrl, esc };
