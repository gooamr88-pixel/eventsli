const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

// Refuses a non-local database unless told otherwise, and disables rate limits.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * The surfaces added with the organizer dashboard and the admin console:
 *
 *   · the door team — a person scans one event with their own account, and
 *     nothing else; removal refuses the next scan, not the next sign-in
 *   · Share & QR — the server builds every link, and a foreign tier is refused
 *   · the stats and admin read endpoints — shape, and who may reach them
 *   · BRD §21 — a checkout without the buyer's acceptance never starts
 */

let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const cleanup = { profiles: [], organizers: [], events: [] };

function client() {
  let cookie = null;
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : null };
  };
}

const organizer = client();
const admin = client();
const staffer = client();
const stranger = client();
let eventId; let organizerId; let tierId; let staffId; let staffToken;

async function register(call, label) {
  const email = `${label}-${stamp}@eventsli-test.invalid`;
  const res = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `${label} person` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  cleanup.profiles.push(res.body.data.id);
  // Registering no longer signs in: confirm as the emailed code would, then sign in.
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', res.body.data.id);
  const login = await call('POST', '/auth/login', { email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id: res.body.data.id, email };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  await register(organizer, 'org');
  const org = await organizer('POST', '/organizer', { displayName: 'Dashboard Test Co', country: 'CA' });
  organizerId = org.body.data.id;
  cleanup.organizers.push(organizerId);

  const adm = await register(admin, 'adm');
  await supabase.from('profiles').update({ role: 'admin' }).eq('id', adm.id);
  await admin('POST', '/auth/login', { email: adm.email, password: PASSWORD });

  await register(stranger, 'stranger');

  const ev = await organizer('POST', '/events', {
    title: 'Door Team Test Night',
    country: 'CA',
    timezone: 'America/Toronto',
    startsAt: new Date(Date.now() + 20 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 20 * 86400e3 + 4 * 3600e3).toISOString(),
  });
  eventId = ev.body.data.id;
  cleanup.events.push(eventId);

  const tier = await organizer('POST', `/events/${eventId}/tiers`, { name: 'VIP', priceCents: 5000, quantity: 20 });
  tierId = tier.body.data.id;
});

after(async () => {
  for (const id of cleanup.events) {
    await supabase.from('scan_devices').delete().eq('event_id', id);
    await supabase.from('event_staff').delete().eq('event_id', id);
    await supabase.from('ticket_tiers').delete().eq('event_id', id);
    await supabase.from('admin_audit').delete().eq('target_id', id);
    await supabase.from('events').delete().eq('id', id);
  }
  for (const id of cleanup.organizers) await supabase.from('organizers').delete().eq('id', id);
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

// ── Share & QR ───────────────────────────────────────────────────────────────

test('share links are built by the server, for this event and its tiers', async () => {
  const res = await organizer('GET', `/events/${eventId}/share`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { event, tiers } = res.body.data;
  assert.match(event.url, new RegExp(`/e/${event.slug}$`));
  assert.equal(event.live, false, 'a draft must say its links do not open anything yet');
  const vip = tiers.find((t) => t.id === tierId);
  assert.equal(new URL(vip.url).searchParams.get('tier'), tierId);
});

test('a QR code is a PNG, and a tier from another event is refused', async () => {
  const png = await organizer('GET', `/events/${eventId}/share/qr.png?tier=${tierId}`);
  assert.equal(png.status, 200);
  assert.match(png.type, /image\/png/);

  const foreign = await organizer('GET', `/events/${eventId}/share/qr.png?tier=${randomUUID()}`);
  assert.equal(foreign.status, 404);
});

test('another account cannot read this event\'s share links', async () => {
  const res = await stranger('GET', `/events/${eventId}/share`);
  assert.equal(res.status, 403, 'an attendee account has no organizer role');
});

// ── Numbers ──────────────────────────────────────────────────────────────────

test('event stats and the organizer dashboard answer in one shape', async () => {
  const stats = await organizer('GET', `/events/${eventId}/stats?days=7`);
  assert.equal(stats.status, 200, JSON.stringify(stats.body));
  assert.equal(stats.body.data.currency, 'CAD');
  assert.equal(stats.body.data.timeline.length, 7);
  assert.ok(stats.body.data.tiers.some((t) => t.id === tierId));

  const dash = await organizer('GET', '/organizer/dashboard?days=30');
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  assert.ok(dash.body.data.events.total >= 1);
  assert.equal(dash.body.data.timeline.length, 30);
});

// ── Publish, so there is a door to work ─────────────────────────────────────

test('the event is published through the normal review loop', async () => {
  await organizer('POST', `/events/${eventId}/accept-terms`);
  const submit = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  const approve = await admin('POST', `/admin/events/${eventId}/approve`);
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
});

// ── The door team ────────────────────────────────────────────────────────────

test('adding someone without an account is refused with a reason', async () => {
  const res = await organizer('POST', `/events/${eventId}/staff`, { email: `nobody-${stamp}@eventsli-test.invalid` });
  assert.equal(res.status, 404);
  assert.match(res.body.message, /account/i);
});

test('a door-team member signs in with their account and scans only this event', async () => {
  const person = await register(staffer, 'staff');
  const added = await organizer('POST', `/events/${eventId}/staff`, { email: person.email });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  staffId = added.body.data.id;

  const mine = await staffer('GET', '/scan/assignments');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.some((e) => e.id === eventId));

  const login = await staffer('POST', '/scan/staff-login', { eventId });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  staffToken = login.body.data.token;

  const status = await staffer('GET', '/scan/status', null, { authorization: `Bearer ${staffToken}` });
  assert.equal(status.status, 200);
});

test('a door-team member reaches nothing else', async () => {
  const orders = await staffer('GET', `/events/${eventId}/orders`);
  assert.equal(orders.status, 403, 'scanning must not open the organizer dashboard');

  const other = await staffer('POST', '/scan/staff-login', { eventId: randomUUID() });
  assert.equal(other.status, 403);
});

test('a staff device can never be opened with a PIN', async () => {
  const { data: device } = await supabase.from('scan_devices').select('id').eq('staff_id', staffId).single();
  const res = await stranger('POST', '/scan/login', { deviceId: device.id, pin: '0000' });
  assert.equal(res.status, 401);
});

test('removing a member refuses their very next scan', async () => {
  const removed = await organizer('DELETE', `/events/${eventId}/staff/${staffId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const status = await staffer('GET', '/scan/status', null, { authorization: `Bearer ${staffToken}` });
  assert.equal(status.status, 401, 'a removed member must be refused on the token they already hold');
});

// ── The admin console's read side ────────────────────────────────────────────

test('the admin console reads, and an organizer cannot', async () => {
  const overview = await admin('GET', '/admin/overview?days=7');
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.ok(overview.body.data.events.total >= 1);

  const events = await admin('GET', `/admin/events?organizerId=${organizerId}`);
  assert.equal(events.status, 200);
  assert.ok(events.body.data.some((e) => e.id === eventId));

  const detail = await admin('GET', `/admin/events/${eventId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.event.id, eventId);

  const organizers = await admin('GET', '/admin/organizers?q=Dashboard%20Test');
  assert.ok(organizers.body.data.some((o) => o.id === organizerId));

  for (const path of ['/admin/overview', '/admin/events', '/admin/organizers']) {
    const res = await organizer('GET', path);
    assert.equal(res.status, 403, `${path} must be admin-only`);
  }
});

// ── BRD §21 ──────────────────────────────────────────────────────────────────

test('a checkout without the buyer accepting the terms is refused before anything else', async () => {
  const res = await stranger('POST', `/public/reservations/${randomUUID()}/checkout`, {
    email: `buyer-${stamp}@eventsli-test.invalid`,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
});
