const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clean, DEFAULTS, publicView } = require('../services/demo/demoSettings');
const { openSlots, isOpen } = require('../services/demo/demoSlots');
const { buildIcs, googleCalendarUrl } = require('../services/demo/demoCalendar');

/**
 * Book a demo (2026-11-19): the rules with no database — what the settings
 * accept, which start times are open, and the calendar file.
 */

const allDay = [['00:00', '23:59']];
const base = (over = {}) => clean({
  timezone: 'UTC', durationMinutes: 30, intervalMinutes: 30, minNoticeHours: 0, maxDaysAhead: 3,
  weeklyHours: { sun: allDay, mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay },
  ...over,
});
// Thursday 2026-11-19 10:00 UTC.
const NOW = Date.parse('2026-11-19T10:00:00Z');

// ── Settings ─────────────────────────────────────────────────────────────

test('nothing saved yet: every default, and a working page', () => {
  const s = clean(undefined);
  assert.equal(s.enabled, true);
  assert.equal(s.durationMinutes, 30);
  assert.deepEqual(s.weeklyHours.mon, [['09:00', '17:00']]);
  assert.deepEqual(s.weeklyHours.sat, []);
  assert.deepEqual(s.topics, DEFAULTS.topics);
});

test('numbers are clamped, zones and links checked, unknown keys dropped', () => {
  const s = clean({
    durationMinutes: 5000, bufferMinutes: -3, capacity: 0, maxDaysAhead: 9999,
    timezone: 'Mars/Olympus', meetingLink: 'http://insecure.example.com', hacker: true,
    contactEmail: 'not-an-email', notifyEmails: ['ok@example.com', 'nope', 'OK@example.com'],
  });
  assert.equal(s.durationMinutes, 180);
  assert.equal(s.bufferMinutes, 0);
  assert.equal(s.capacity, 1);
  assert.equal(s.maxDaysAhead, 365);
  assert.equal(s.timezone, DEFAULTS.timezone);
  assert.equal(s.meetingLink, '', 'only https links');
  assert.equal(s.hacker, undefined);
  assert.equal(s.contactEmail, DEFAULTS.contactEmail);
  assert.deepEqual(s.notifyEmails, ['ok@example.com']);
});

test('a day\'s hours: bad pairs dropped, overlaps merged, sorted', () => {
  const s = clean({ weeklyHours: { mon: [['13:00', '17:00'], ['09:00', '12:00'], ['11:00', '14:00'], ['18:00', '17:00'], ['25:00', '26:00']] } });
  assert.deepEqual(s.weeklyHours.mon, [['09:00', '17:00']]);
  assert.deepEqual(s.weeklyHours.tue, [], 'a day not sent is closed once weeklyHours is sent');
});

test('custom questions: a select needs options, ids are unique, at most ten', () => {
  const s = clean({
    questions: [
      { id: 'size', label: 'Guests?', type: 'select', options: ['A', 'B', 'A'] },
      { id: 'size', label: 'Again', type: 'text', required: true },
      { label: 'Empty select', type: 'select', options: [] },
      { label: '' },
      ...Array.from({ length: 12 }, (_, i) => ({ label: `Q${i}` })),
    ],
  });
  assert.deepEqual(s.questions[0], { id: 'size', label: 'Guests?', type: 'select', options: ['A', 'B'], required: false });
  assert.notEqual(s.questions[1].id, 'size');
  assert.equal(s.questions[1].required, true);
  assert.ok(s.questions.length <= 10);
  assert.ok(!s.questions.some((q) => q.label === 'Empty select'));
});

test('the public view leaves out who is notified', () => {
  const v = publicView(clean({ notifyEmails: ['team@example.com'] }));
  assert.equal(v.notifyEmails, undefined);
  assert.equal(v.notifyAdmins, undefined);
  assert.equal(v.reminderHours, undefined);
});

// ── Open times ───────────────────────────────────────────────────────────

test('the host\'s weekly hours, in the host\'s zone', () => {
  const s = clean({ timezone: 'America/Toronto', minNoticeHours: 0, maxDaysAhead: 2 });
  const slots = openSlots(s, [], { now: NOW });
  // Thursday 10:00 UTC is 05:00 in Toronto: the first open start is 09:00 there (14:00 UTC).
  assert.equal(slots[0], '2026-11-19T14:00:00.000Z');
  // 9 to 5, every 30 minutes, the last one starting at 16:30 (21:30 UTC).
  assert.equal(slots.filter((x) => x.startsWith('2026-11-19')).length, 16);
  assert.ok(slots.includes('2026-11-19T21:30:00.000Z'));
  assert.ok(!slots.includes('2026-11-19T22:00:00.000Z'));
  // Saturday is closed by default.
  assert.ok(!slots.some((x) => x.startsWith('2026-11-21')));
});

test('notice and horizon', () => {
  const slots = openSlots(base({ minNoticeHours: 5, maxDaysAhead: 1 }), [], { now: NOW });
  assert.equal(slots[0], '2026-11-19T15:00:00.000Z');
  assert.ok(slots.at(-1) < '2026-11-21T00:00:00.000Z');
});

test('blocked dates and the daily limit', () => {
  const blocked = openSlots(base({ blockedDates: ['2026-11-20'] }), [], { now: NOW });
  assert.ok(!blocked.some((x) => x.startsWith('2026-11-20')));
  const full = openSlots(base({ dailyLimit: 1 }), [{ startsAt: '2026-11-20T09:00:00Z', endsAt: '2026-11-20T09:30:00Z' }], { now: NOW });
  assert.ok(!full.some((x) => x.startsWith('2026-11-20')), 'one booked, limit one: the day is full');
  assert.ok(full.some((x) => x.startsWith('2026-11-21')));
});

test('a booking takes its time, padded by the buffer; capacity allows overlaps', () => {
  const booked = [{ startsAt: '2026-11-20T12:00:00Z', endsAt: '2026-11-20T12:30:00Z' }];
  const one = openSlots(base({ bufferMinutes: 15 }), booked, { now: NOW });
  assert.ok(!one.includes('2026-11-20T12:00:00.000Z'));
  assert.ok(!one.includes('2026-11-20T11:30:00.000Z'), 'ends 12:00, but the 15-minute buffer reaches it');
  assert.ok(!one.includes('2026-11-20T12:30:00.000Z'));
  assert.ok(one.includes('2026-11-20T13:00:00.000Z'));
  const two = openSlots(base({ capacity: 2 }), booked, { now: NOW });
  assert.ok(two.includes('2026-11-20T12:00:00.000Z'));
});

test('a window has to hold the whole demo; the interval can differ from the length', () => {
  const s = base({ durationMinutes: 45, intervalMinutes: 15, weeklyHours: { fri: [['09:00', '10:30']] } });
  const fri = openSlots(s, [], { now: NOW }).filter((x) => x.startsWith('2026-11-20'));
  assert.deepEqual(fri.map((x) => x.slice(11, 16)), ['09:00', '09:15', '09:30', '09:45']);
});

test('a daylight-saving gap: the hour the clock skips is not offered', () => {
  // 2027-03-14, Toronto: 02:00 jumps to 03:00.
  const s = clean({
    timezone: 'America/Toronto', minNoticeHours: 0, maxDaysAhead: 5, durationMinutes: 30, intervalMinutes: 30,
    weeklyHours: { sun: [['01:00', '04:00']] },
  });
  const now = Date.parse('2027-03-12T12:00:00Z');
  const local = openSlots(s, [], { now }).map((x) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(x)));
  assert.deepEqual(local, ['01:00', '01:30', '03:00', '03:30']);
});

test('isOpen: exactly an offered start, nothing in between', () => {
  const s = base();
  assert.equal(isOpen(s, [], '2026-11-20T12:00:00.000Z', { now: NOW }), true);
  assert.equal(isOpen(s, [], '2026-11-20T12:07:00.000Z', { now: NOW }), false);
  assert.equal(isOpen(s, [], '2026-11-19T09:00:00.000Z', { now: NOW }), false, 'in the past');
  assert.equal(isOpen(s, [], 'nonsense', { now: NOW }), false);
});

// ── Calendar ─────────────────────────────────────────────────────────────

test('the .ics escapes text, folds long lines and marks a cancellation', () => {
  const ics = buildIcs({
    uid: 'abc', sequence: 2, start: '2026-11-20T12:00:00Z', end: '2026-11-20T12:30:00Z',
    title: 'Demo; with, Eventsli', description: `Line one\nLine two ${'x'.repeat(120)}`, cancelled: true,
  });
  assert.match(ics, /SUMMARY:Demo\\; with\\, Eventsli/);
  assert.match(ics, /DTSTART:20261120T120000Z/);
  assert.match(ics, /SEQUENCE:2/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /METHOD:CANCEL/);
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
});

test('the Google Calendar link carries the UTC span', () => {
  const url = new URL(googleCalendarUrl({ start: '2026-11-20T12:00:00Z', end: '2026-11-20T12:30:00Z', title: 'Demo' }));
  assert.equal(url.searchParams.get('dates'), '20261120T120000Z/20261120T123000Z');
});

// ── The booker's link ────────────────────────────────────────────────────

test('the manage token: derived per booking, checked exactly', () => {
  const saved = { own: process.env.DEMO_LINK_SECRET, jwt: process.env.JWT_SECRET };
  process.env.DEMO_LINK_SECRET = 'test-secret';
  delete require.cache[require.resolve('../services/demo/demoLinks')];
  const { tokenFor, tokenMatches } = require('../services/demo/demoLinks');
  const a = tokenFor('11111111-1111-1111-1111-111111111111');
  assert.equal(a.length, 32);
  assert.equal(tokenFor('11111111-1111-1111-1111-111111111111'), a, 'the same link in every email');
  assert.notEqual(tokenFor('22222222-2222-2222-2222-222222222222'), a);
  assert.equal(tokenMatches('11111111-1111-1111-1111-111111111111', a), true);
  assert.equal(tokenMatches('22222222-2222-2222-2222-222222222222', a), false);
  assert.equal(tokenMatches('11111111-1111-1111-1111-111111111111', 'x'.repeat(32)), false);
  assert.equal(tokenMatches('11111111-1111-1111-1111-111111111111', undefined), false);
  if (saved.own === undefined) delete process.env.DEMO_LINK_SECRET; else process.env.DEMO_LINK_SECRET = saved.own;
});
