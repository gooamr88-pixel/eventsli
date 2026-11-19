const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * BOOK A DEMO, END TO END (2026-11-19).
 *
 * The public page books, the booker's own link changes and cancels, the
 * console runs the bookings and only a super admin changes the settings.
 * The race that matters: two people pressing Book on the last open time at
 * once get ONE booking (book_demo's lock), never two demos on top of each
 * other.
 *
 * The settings are platform-wide, so the originals are put back afterwards.
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const users = [];
let superCookie; let adminCookie; let originalSettings = null; let hadSettings = false;

async function account(role) {
  const email = `demo-${role}-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: `Demo ${role}` }),
  });
  const id = (await reg.json()).data.id;
  users.push(id);
  await supabase.from('profiles').update({ role, email_verified_at: new Date().toISOString() }).eq('id', id);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (login.headers.get('set-cookie') || '').split(';')[0];
}

const call = async (method, path, { cookie, body } = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const booker = (n, startsAt) => ({
  startsAt, name: `Booker ${n}`, email: `demo-booker-${n}-${stamp}@eventsli-test.invalid`,
  company: 'Test event', timezone: 'Africa/Cairo',
});

async function openTimes() {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const r = await call('GET', `/public/demo/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return r.body.data.slots;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data } = await supabase.from('platform_settings').select('value').eq('key', 'demo_booking').maybeSingle();
  hadSettings = Boolean(data);
  originalSettings = data?.value ?? null;

  superCookie = await account('super_admin');
  adminCookie = await account('admin');

  // Every day, all day, on UTC, no notice: the test does not depend on the clock.
  const allDay = [['00:00', '23:59']];
  const r = await call('PUT', '/admin/demo/settings', {
    cookie: superCookie,
    body: {
      settings: {
        enabled: true, timezone: 'UTC', durationMinutes: 30, intervalMinutes: 30, minNoticeHours: 0,
        maxDaysAhead: 3, capacity: 1, dailyLimit: 0, bufferMinutes: 0, notifyAdmins: false, reminderHours: 0,
        weeklyHours: { sun: allDay, mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay },
        fields: { company: { mode: 'required', label: 'Your event' } },
        questions: [{ id: 'size', label: 'How many guests?', type: 'select', options: ['Under 100', '100+'], required: true }],
      },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

after(async () => {
  await supabase.from('demo_bookings').delete().like('email', `%-${stamp}@eventsli-test.invalid`);
  if (hadSettings) await supabase.from('platform_settings').update({ value: originalSettings }).eq('key', 'demo_booking');
  else await supabase.from('platform_settings').delete().eq('key', 'demo_booking');
  for (const id of users) {
    await supabase.from('admin_audit').delete().eq('actor_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('only a super admin changes the settings; every admin can read them', async () => {
  const read = await call('GET', '/admin/demo/settings', { cookie: adminCookie });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.settings.timezone, 'UTC');
  const write = await call('PUT', '/admin/demo/settings', { cookie: adminCookie, body: { settings: { enabled: false } } });
  assert.equal(write.status, 403);
  const anon = await call('GET', '/admin/demo/settings');
  assert.equal(anon.status, 401);
});

test('the public page sees the form but not the notify list', async () => {
  const r = await call('GET', '/public/demo');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.fields.company.label, 'Your event');
  assert.equal(r.body.data.questions[0].id, 'size');
  assert.equal(r.body.data.notifyEmails, undefined);
  assert.equal(r.body.data.reminderHours, undefined);
});

test('a required custom question is required', async () => {
  const [slot] = await openTimes();
  const r = await call('POST', '/public/demo/bookings', { body: booker('q', slot) });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /How many guests/);
});

test('two people pressing Book on the same time at once: one booking', async () => {
  const slot = (await openTimes())[2];
  const answers = { size: '100+' };
  const results = await Promise.all([1, 2, 3, 4].map((n) => call('POST', '/public/demo/bookings', {
    body: { ...booker(`race${n}`, slot), answers },
  })));
  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status === 409);
  assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(lost.length, 3);
  assert.ok(lost.every((r) => r.body.error === 'DEMO_SLOT_TAKEN'));
  const { count } = await supabase.from('demo_bookings')
    .select('id', { count: 'exact', head: true }).eq('starts_at', slot).eq('status', 'confirmed');
  assert.equal(count, 1);
  assert.equal(won[0].body.data.booking.startsAt, slot);
  assert.deepEqual(
    (await supabase.from('demo_bookings').select('answers').eq('id', won[0].body.data.booking.id).single()).data.answers,
    [{ id: 'size', label: 'How many guests?', answer: '100+' }],
  );
});

test('the console lists, notes, marks, moves and cancels', async () => {
  const times = await openTimes();
  const made = await call('POST', '/public/demo/bookings', { body: { ...booker('console', times[6]), answers: { size: 'Under 100' } } });
  assert.equal(made.status, 201);
  const id = made.body.data.booking.id;

  const listed = await call('GET', '/admin/demo/bookings?view=upcoming', { cookie: adminCookie });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.bookings.some((b) => b.id === id));
  assert.ok(listed.body.data.counts.upcoming >= 1);

  const noted = await call('PATCH', `/admin/demo/bookings/${id}`, {
    cookie: adminCookie, body: { hostNotes: 'Runs a 300-seat gala', meetingLink: 'https://meet.example.com/abc' },
  });
  assert.equal(noted.status, 200);
  assert.equal(noted.body.data.booking.meetingLink, 'https://meet.example.com/abc');
  const badLink = await call('PATCH', `/admin/demo/bookings/${id}`, { cookie: adminCookie, body: { meetingLink: 'http://plain' } });
  assert.equal(badLink.status, 400);

  // Moving onto the time another demo holds is refused (capacity 1)…
  const other = await call('POST', '/public/demo/bookings', { body: { ...booker('other', times[8]), answers: { size: '100+' } } });
  const clash = await call('POST', `/admin/demo/bookings/${id}/reschedule`, {
    cookie: adminCookie, body: { startsAt: other.body.data.booking.startsAt, notify: false },
  });
  assert.equal(clash.status, 409);
  // …but an admin may move it outside the public hours' menu, to a free time.
  const free = new Date(Date.parse(times[10]) + 10 * 60_000).toISOString();
  const moved = await call('POST', `/admin/demo/bookings/${id}/reschedule`, { cookie: adminCookie, body: { startsAt: free, notify: false } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.data.booking.startsAt, free);
  assert.equal(moved.body.data.booking.rescheduleCount, 1);

  const cancelled = await call('POST', `/admin/demo/bookings/${id}/cancel`, { cookie: adminCookie, body: { reason: 'Double-booked', notify: false } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.booking.status, 'cancelled');
  assert.equal(cancelled.body.data.booking.cancelledBy, 'admin');
  const reopen = await call('PATCH', `/admin/demo/bookings/${id}`, { cookie: adminCookie, body: { status: 'confirmed' } });
  assert.equal(reopen.status, 409, 'a cancelled demo stays cancelled');

  const { data: trail } = await supabase.from('admin_audit').select('action').eq('target_id', id);
  const actions = trail.map((t) => t.action).sort();
  assert.deepEqual(actions, ['demo.booking_cancelled', 'demo.booking_rescheduled', 'demo.booking_updated']);
});

test('the booker\'s link: view, move, calendar file, cancel — and nothing without it', async () => {
  const times = await openTimes();
  const made = await call('POST', '/public/demo/bookings', { body: { ...booker('self', times[12]), answers: { size: '100+' } } });
  const { booking, token } = made.body.data;

  assert.equal((await call('GET', `/public/demo/bookings/${booking.id}?t=${'x'.repeat(32)}`)).status, 404);
  const seen = await call('GET', `/public/demo/bookings/${booking.id}?t=${token}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.data.booking.hostNotes, undefined, 'host notes never reach the booker');

  const moved = await call('POST', `/public/demo/bookings/${booking.id}/reschedule`, { body: { t: token, startsAt: times[14] } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.data.booking.startsAt, times[14]);
  // The booker may only move to an OPEN time on the public menu.
  const offMenu = new Date(Date.parse(times[16]) + 7 * 60_000).toISOString();
  assert.equal((await call('POST', `/public/demo/bookings/${booking.id}/reschedule`, { body: { t: token, startsAt: offMenu } })).status, 409);

  const ics = await fetch(`${baseUrl}/public/demo/bookings/${booking.id}/calendar.ics?t=${token}`);
  assert.equal(ics.status, 200);
  assert.match(await ics.text(), /BEGIN:VEVENT[\s\S]*SEQUENCE:1/);

  const gone = await call('POST', `/public/demo/bookings/${booking.id}/cancel`, { body: { t: token } });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.data.booking.canChange, false);
  assert.ok((await openTimes()).includes(times[14]), 'the cancelled time is open again');
});

test('switched off: no times, and booking refuses', async () => {
  await call('PUT', '/admin/demo/settings', { cookie: superCookie, body: { settings: { ...(await call('GET', '/admin/demo/settings', { cookie: superCookie })).body.data.settings, enabled: false } } });
  assert.deepEqual(await openTimes(), []);
  const r = await call('POST', '/public/demo/bookings', { body: { ...booker('off', new Date(Date.now() + 86_400_000).toISOString()), answers: { size: '100+' } } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'FEATURE_DISABLED');
});
