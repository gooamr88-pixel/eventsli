const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const ticketSvc = require('../../services/ticketService');
const scanSvc = require('../../services/scanService');
const { hashPassword } = require('../../utils/crypto');

/**
 * The native check-in app's API, end to end:
 *
 *   • signing in — a password (token in the body, no cookie) and "Sign in
 *     with Eventsli" (authorization code + PKCE), both ordinary revocable
 *     sessions;
 *   • the event picker — Upcoming / Ongoing / Past with door counts;
 *   • the door — who am I, recent arrivals, the guest list, one ticket,
 *     manual check-in, analytics — and WHO may see WHAT: the organizer
 *     everything, the door team only what the organizer shares.
 */

const TEST_ACCOUNT = `acct_test_app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = { profiles: [], events: [] };
let server; let baseUrl;
let tickets = [];
let ownerEmail; let staffEmail;
let ownerDevice; let staffDevice; let pinDevice;

async function api(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    setCookie: res.headers.get('set-cookie'),
    body: await res.json().catch(() => null),
  };
}

async function person(label, role = 'attendee') {
  const email = `app-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `${label[0].toUpperCase()}${label.slice(1)} Person`, role,
    password_hash: await hashPassword(PASSWORD),
    email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  ids.profiles.push(data.id);
  return { id: data.id, email };
}

async function event(organizerId, termsId, overrides) {
  const { data, error } = await supabase.from('events').insert({
    organizer_id: organizerId, country: 'CA', timezone: 'America/Toronto',
    currency: 'CAD', status: 'published', terms_accepted_id: termsId,
    purchase_mode: 'seat_only', city: 'Toronto', venue_name: 'App Test Hall',
    starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86400e3 + 3 * 3600e3).toISOString(),
    ...overrides,
  }).select('id').single();
  if (error) throw new Error(`seed event: ${error.message}`);
  ids.events.push(data.id);
  return data.id;
}

async function seed() {
  const owner = await person('owner', 'organizer');
  ownerEmail = owner.email;
  const staff = await person('staff');
  staffEmail = staff.email;

  const { data: org } = await supabase.from('organizers').insert({
    stripe_account_id: TEST_ACCOUNT, owner_user_id: owner.id, display_name: 'App Test Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: owner.id, terms_id: terms.id });

  // The event under test, on sale in the future so fulfilment accepts the
  // purchase — then moved to "doors open now".
  ids.event = await event(org.id, terms.id, { slug: `app-test-${stamp}`, title: 'App Test Gala' });
  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ids.event, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ids.event, name: 'General Admission', price_cents: 2500 }).select('id').single();
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 4 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: 'B', seat_number: String(i + 1),
    })),
  ).select('id');
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: seats.map((s) => s.id), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Sara Ahmed', email: 'sara@eventsli-test.invalid' },
    p_stripe: { account_id: TEST_ACCOUNT, session_id: `cs_app_${stamp}` },
  });
  ids.order = filled.data.order_id;
  tickets = await ticketSvc.forOrder(ids.order);

  await supabase.from('events').update({
    starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  }).eq('id', ids.event);

  // The picker's other two tabs.
  ids.upcoming = await event(org.id, terms.id, { slug: `app-up-${stamp}`, title: 'App Test Upcoming' });
  ids.past = await event(org.id, terms.id, {
    slug: `app-past-${stamp}`, title: 'App Test Past', status: 'completed',
    starts_at: new Date(Date.now() - 4 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() - 4 * 86400e3 + 3 * 3600e3).toISOString(),
  });

  // The staff member is on the door team of the event under test only.
  await supabase.from('event_staff').insert({ event_id: ids.event, user_id: staff.id, added_by: owner.id });

  const pin = await scanSvc.registerDevice({ eventId: ids.event, label: 'North door', pin: '482193' });
  ids.pinDeviceId = pin.id;
  pinDevice = (await scanSvc.authenticateDevice({ deviceId: pin.id, pin: '482193' })).token;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  for (const id of ids.events) {
    await supabase.from('scans').delete().eq('event_id', id);
    await supabase.from('scan_devices').delete().eq('event_id', id);
    await supabase.from('event_staff').delete().eq('event_id', id);
    await supabase.from('event_gate_settings').delete().eq('event_id', id);
  }
  if (ids.order) {
    await supabase.from('tickets').delete().eq('order_id', ids.order);
    await supabase.from('order_items').delete().eq('order_id', ids.order);
    await supabase.from('orders').delete().eq('id', ids.order);
  }
  if (ids.event) {
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
  }
  for (const id of ids.events) await supabase.from('events').delete().eq('id', id);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  for (const id of ids.profiles) {
    await supabase.from('app_auth_codes').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

const appLogin = (email, extra = {}) => api('POST', '/auth/app/login', {
  body: { email, password: PASSWORD, deviceName: 'Test iPhone', ...extra },
});

// ── Signing in ──────────────────────────────────────────────────────────────

test('the app signs in with a password and gets its token in the body, not a cookie', async () => {
  const res = await appLogin(ownerEmail);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.token, 'the app has no cookie jar; it needs the token');
  assert.equal(res.setCookie, null, 'and must not be handed a cookie it cannot use');
  assert.equal(res.body.data.user.email, ownerEmail);

  // About fourteen days, not the site's one.
  const days = (new Date(res.body.data.expiresAt) - Date.now()) / 86400e3;
  assert.ok(days > 13 && days <= 14, `${days} days`);

  const me = await api('GET', '/auth/me', { token: res.body.data.token });
  assert.equal(me.status, 200);

  // A normal session row: listed on the web, labelled, and revocable there.
  const list = await api('GET', '/auth/sessions', { token: res.body.data.token });
  const mine = list.body.data.find((s) => s.current);
  assert.equal(mine.client, 'checkin_app');
  assert.equal(mine.deviceName, 'Test iPhone');

  const out = await api('POST', '/auth/logout', { token: res.body.data.token });
  assert.equal(out.status, 200);
  assert.equal((await api('GET', '/auth/me', { token: res.body.data.token })).status, 401,
    'signing out on the phone ends the session on the server');
});

test('the app is not a side door around the password check', async () => {
  const res = await api('POST', '/auth/app/login', { body: { email: ownerEmail, password: 'wrong-password-entirely' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
  assert.equal(res.body.data, undefined);
});

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
const REDIRECT = 'eventsli-checkin://auth/callback';

test('Sign in with Eventsli: a code approved on the web, traded once with its verifier', async () => {
  const web = (await appLogin(ownerEmail)).body.data.token;   // stands in for the site's cookie session
  const { verifier, challenge } = pkce();

  assert.equal((await api('POST', '/auth/app/authorize', {
    body: { codeChallenge: challenge, redirectUri: REDIRECT },
  })).status, 401, 'only somebody signed in on the website can approve');

  const bad = await api('POST', '/auth/app/authorize', {
    token: web, body: { codeChallenge: challenge, redirectUri: 'https://evil.example/cb' },
  });
  assert.equal(bad.status, 400, 'a code is only ever sent back to the app');

  const ok = await api('POST', '/auth/app/authorize', {
    token: web, body: { codeChallenge: challenge, redirectUri: REDIRECT },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const { code } = ok.body.data;

  const traded = await api('POST', '/auth/app/token', {
    body: { code, codeVerifier: verifier, redirectUri: REDIRECT, deviceName: 'Pixel' },
  });
  assert.equal(traded.status, 200, JSON.stringify(traded.body));
  assert.ok(traded.body.data.token);
  assert.equal(traded.body.data.user.email, ownerEmail);

  const again = await api('POST', '/auth/app/token', {
    body: { code, codeVerifier: verifier, redirectUri: REDIRECT },
  });
  assert.equal(again.status, 400, 'a code is single-use');
  assert.equal(again.body.error, 'INVALID_CODE');
});

test('a code is useless without its verifier, and a wrong guess burns it', async () => {
  const web = (await appLogin(ownerEmail)).body.data.token;
  const { verifier, challenge } = pkce();
  const { code } = (await api('POST', '/auth/app/authorize', {
    token: web, body: { codeChallenge: challenge, redirectUri: REDIRECT },
  })).body.data;

  const stolen = await api('POST', '/auth/app/token', {
    body: { code, codeVerifier: pkce().verifier, redirectUri: REDIRECT },
  });
  assert.equal(stolen.status, 400);

  const late = await api('POST', '/auth/app/token', { body: { code, codeVerifier: verifier, redirectUri: REDIRECT } });
  assert.equal(late.status, 400, 'the intercepted code was spent by the wrong guess');
});

test('an expired code is refused', async () => {
  const web = (await appLogin(ownerEmail)).body.data.token;
  const { verifier, challenge } = pkce();
  const { code } = (await api('POST', '/auth/app/authorize', {
    token: web, body: { codeChallenge: challenge, redirectUri: REDIRECT },
  })).body.data;
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  await supabase.from('app_auth_codes')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('code_hash', hash);

  const res = await api('POST', '/auth/app/token', { body: { code, codeVerifier: verifier, redirectUri: REDIRECT } });
  assert.equal(res.status, 400);
});

test('the app config is public', async () => {
  const res = await api('GET', '/app/config');
  assert.equal(res.status, 200);
  assert.match(res.body.data.minSupportedVersion.ios, /^\d+\.\d+\.\d+$/);
  assert.match(res.body.data.minSupportedVersion.android, /^\d+\.\d+\.\d+$/);
});

// ── The event picker ────────────────────────────────────────────────────────

test('the picker groups Upcoming / Ongoing / Past, with the door counts', async () => {
  const token = (await appLogin(ownerEmail)).body.data.token;
  const res = await api('GET', '/scan/assignments?scope=all', { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { upcoming, ongoing, past } = res.body.data;

  const live = ongoing.find((e) => e.id === ids.event);
  assert.ok(live, 'the event with doors open is Ongoing');
  assert.equal(live.scannable, true);
  assert.equal(live.city, 'Toronto');
  assert.deepEqual(live.stats, { issued: 4, admitted: 0 });
  assert.ok(upcoming.some((e) => e.id === ids.upcoming));
  const done = past.find((e) => e.id === ids.past);
  assert.ok(done, 'a finished event is under Past');
  assert.equal(done.scannable, false);

  // The web gate's answer is unchanged: a flat list of what can be scanned.
  const flat = await api('GET', '/scan/assignments', { token });
  assert.ok(Array.isArray(flat.body.data));
  assert.ok(!flat.body.data.some((e) => e.id === ids.past));
});

test('a door-team member sees only the events they work', async () => {
  const token = (await appLogin(staffEmail)).body.data.token;
  const { upcoming, ongoing, past } = (await api('GET', '/scan/assignments?scope=all', { token })).body.data;
  const all = [...upcoming, ...ongoing, ...past].map((e) => e.id);
  assert.deepEqual(all, [ids.event]);
});

// ── At the door: who may see what ───────────────────────────────────────────

test('each kind of door principal knows what it is', async () => {
  const owner = (await appLogin(ownerEmail)).body.data.token;
  ownerDevice = (await api('POST', '/scan/staff-login', { token: owner, body: { eventId: ids.event } })).body.data.token;
  const staff = (await appLogin(staffEmail)).body.data.token;
  staffDevice = (await api('POST', '/scan/staff-login', { token: staff, body: { eventId: ids.event } })).body.data.token;

  const o = await api('GET', '/scan/me', { token: ownerDevice });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(o.body.data.role, 'owner');
  assert.equal(o.body.data.permissions.viewGuests, true);
  assert.equal(o.body.data.event.title, 'App Test Gala');
  assert.equal(o.body.data.stats.issued, 4);

  const s = await api('GET', '/scan/me', { token: staffDevice });
  assert.equal(s.body.data.role, 'staff');
  assert.equal(s.body.data.permissions.viewGuests, false, 'the guest list is the organizer’s to share');

  const p = await api('GET', '/scan/me', { token: pinDevice });
  assert.equal(p.body.data.role, 'pin');
  assert.equal(p.body.data.device.label, 'North door');
});

test('the door team cannot search guests or check them in by hand until the organizer allows it', async () => {
  for (const token of [staffDevice, pinDevice]) {
    const list = await api('GET', '/scan/attendees', { token });
    assert.equal(list.status, 403);
    const manual = await api('POST', '/scan/manual-check-in', { token, body: { ticketId: tickets[0].id } });
    assert.equal(manual.status, 403);
  }
});

test('the organizer searches the guest list and checks someone in by hand', async () => {
  const list = await api('GET', '/scan/attendees?q=sara&status=out', { token: ownerDevice });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.pagination.total, 4);
  assert.equal(list.body.data[0].holder, 'Sara Ahmed');
  assert.equal(list.body.data[0].tier, 'General Admission');
  assert.equal(list.body.data[0].email, undefined, 'the address is searched, never returned');

  const none = await api('GET', `/scan/attendees?q=${encodeURIComponent('100%')}`, { token: ownerDevice });
  assert.equal(none.body.pagination.total, 0, 'a % is a character, not a wildcard');

  const manual = await api('POST', '/scan/manual-check-in', { token: ownerDevice, body: { ticketId: tickets[0].id } });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  assert.equal(manual.body.data.result, 'admitted');
  assert.equal(manual.body.data.method, 'manual');

  const twice = await api('POST', '/scan/manual-check-in', { token: ownerDevice, body: { ticketId: tickets[0].id } });
  assert.equal(twice.body.data.result, 'duplicate');
});

test('recent arrivals: full names for the organizer, shortened for the door team', async () => {
  await api('POST', '/scan/verify', { token: staffDevice, body: { qr: tickets[1].qr } });

  const forOwner = await api('GET', '/scan/recent', { token: ownerDevice });
  assert.equal(forOwner.status, 200);
  assert.equal(forOwner.body.data.length, 2);
  assert.ok(forOwner.body.data.every((r) => r.holder === 'Sara Ahmed'));
  assert.equal(forOwner.body.data[0].ticketId, tickets[1].id, 'newest first');

  const forStaff = await api('GET', '/scan/recent', { token: staffDevice });
  assert.ok(forStaff.body.data.every((r) => r.holder === 'Sara A.'));

  const all = await api('GET', '/scan/recent?kind=all', { token: ownerDevice });
  assert.ok(all.body.data.some((r) => r.result === 'duplicate'), 'View All includes refusals');
});

test('sharing the guest list opens it to the door team, and only to their event', async () => {
  const set = await api('PATCH', `/events/${ids.event}/gate-settings`, {
    token: (await appLogin(ownerEmail)).body.data.token,
    body: { doorTeamCanViewGuests: true },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.doorTeamCanViewGuests, true);
  assert.equal(set.body.data.offlineAdmission, true, 'a partial update leaves the rest alone');

  const list = await api('GET', '/scan/attendees', { token: staffDevice });
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].holder, 'Sara Ahmed');

  // Another organizer's event is not theirs to configure.
  const stranger = (await appLogin(staffEmail)).body.data.token;
  const denied = await api('PATCH', `/events/${ids.event}/gate-settings`, { token: stranger, body: { offlineAdmission: false } });
  assert.ok([403, 404].includes(denied.status));
});

test('one ticket, with its history, and nothing from another event', async () => {
  const res = await api('GET', `/scan/tickets/${tickets[0].id}`, { token: ownerDevice });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'scanned');
  assert.deepEqual(res.body.data.history.map((h) => h.result), ['duplicate', 'admitted']);
  assert.equal(res.body.data.history[1].method, 'manual');

  const foreign = await api('GET', `/scan/tickets/${crypto.randomUUID()}`, { token: ownerDevice });
  assert.equal(foreign.status, 404);
});

test('analytics add up to the gate’s own counts', async () => {
  const res = await api('GET', '/scan/analytics?bucket=15', { token: ownerDevice });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.data;
  assert.deepEqual(a.stats, { issued: 4, admitted: 2, pending: 2, void: 0 });
  assert.equal(a.timeline.reduce((n, b) => n + b.admitted, 0), 2);
  assert.deepEqual(a.byMethod, { manual: 1, scan: 1 });
  assert.equal(a.byTier[0].tier, 'General Admission');
  assert.equal(a.byTier[0].admitted, 2);
  assert.equal(a.lastFiveMinutes, 2);
  assert.ok(a.refusals.some((r) => r.result === 'duplicate'));

  const gate = await api('GET', '/scan/status', { token: ownerDevice });
  assert.equal(gate.body.data.stats.admitted, a.stats.admitted);
});

test('an organizer gets a pairing code for a shared tablet, and only for their own', async () => {
  const token = (await appLogin(ownerEmail)).body.data.token;
  const res = await fetch(`${baseUrl}/events/${ids.event}/scan-devices/${ids.pinDeviceId}/pairing.png`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok((await res.arrayBuffer()).byteLength > 200);

  const other = await fetch(`${baseUrl}/events/${ids.event}/scan-devices/${crypto.randomUUID()}/pairing.png`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(other.status, 404);
});

test('door settings only take the values they understand', async () => {
  const token = (await appLogin(ownerEmail)).body.data.token;
  const bad = await api('PATCH', `/events/${ids.event}/gate-settings`, { token, body: { legacyQrOffline: 'sometimes' } });
  assert.equal(bad.status, 400);
  const read = await api('GET', `/events/${ids.event}/gate-settings`, { token });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.legacyQrOffline, 'allow');
});
