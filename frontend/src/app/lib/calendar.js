/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Add to calendar" for a bought ticket (owner, 2026-11-18).
 *
 * Three ways, because no single one reaches everybody:
 *   · Google Calendar   a link that opens a pre-filled event
 *   · Outlook.com       the same, for Microsoft accounts
 *   · an .ics file      Apple Calendar, Outlook desktop and everything else
 *
 * Times are written in UTC (`…Z`). The calendar shows them in the reader's own
 * zone, which is correct: the event's instant does not depend on where the
 * reader is, and a floating local time would be wrong for anyone travelling.
 *
 * No end time → three hours, the length a calendar needs to draw a block.
 * Pure functions; the component only wires them to buttons.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_HOURS = 3;

function range(event) {
  const start = new Date(event?.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  let end = new Date(event?.endsAt);
  if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + DEFAULT_HOURS * 36e5);
  return { start, end };
}

import { addressLine } from './venueAddress';

/** 20270314T230000Z */
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function place(event) {
  const venue = typeof event?.venue === 'string' ? event.venue : event?.venue?.name;
  const address = addressLine(event);
  return [venue, address].filter(Boolean).join(', ');
}

function details(event, pageUrl) {
  return [
    event?.organizerName ? `Organized by ${event.organizerName}.` : null,
    pageUrl ? `Event page: ${pageUrl}` : null,
    'Your tickets are in your Eventsli confirmation email.',
  ].filter(Boolean).join('\n');
}

export function googleCalendarUrl(event, pageUrl = null) {
  const r = range(event);
  if (!r) return null;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Event',
    dates: `${stamp(r.start)}/${stamp(r.end)}`,
    details: details(event, pageUrl),
    location: place(event),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function outlookCalendarUrl(event, pageUrl = null) {
  const r = range(event);
  if (!r) return null;
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title || 'Event',
    startdt: r.start.toISOString(),
    enddt: r.end.toISOString(),
    body: details(event, pageUrl),
    location: place(event),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}

/** RFC 5545 text: backslash, semicolon, comma and newline escaped. */
const icsText = (s) => String(s || '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 §3.1). */
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function icsFile(event, pageUrl = null, now = new Date()) {
  const r = range(event);
  if (!r) return null;
  const uid = `${event.slug || 'event'}-${stamp(r.start)}@eventsli.com`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Eventsli//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(r.start)}`,
    `DTEND:${stamp(r.end)}`,
    `SUMMARY:${icsText(event.title || 'Event')}`,
    place(event) ? `LOCATION:${icsText(place(event))}` : null,
    `DESCRIPTION:${icsText(details(event, pageUrl))}`,
    pageUrl ? `URL:${pageUrl}` : null,
    // A reminder the day before — the moment people check how to get there.
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(`Tomorrow: ${event.title || 'your event'}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** A filename from the title: "Starlight Gala" → "starlight-gala.ics". */
export function icsFilename(event) {
  const base = String(event?.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'event'}.ics`;
}
