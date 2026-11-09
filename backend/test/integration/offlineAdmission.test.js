const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

// A signing key of this suite's own, whatever backend/.env holds: QR v2 codes
// are what make offline admission safe, so they are what is tested here.
const { privateKey: SIGNING_KEY } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
process.env.QR_SIGNING_KEY = SIGNING_KEY.export({ type: 'pkcs8', format: 'pem' });
process.env.QR_SIGNING_KID = 'offline-test';

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const ticketSvc = require('../../services/ticketService');
const scanSvc = require('../../services/scanService');
const { hashPassword } = require('../../utils/crypto');

/**
 * Offline admission, the server's half (docs/CHECKIN-APP-API.md §7):
 *
 *   • GET /scan/keys — the public keys that verify QR v2 codes on a phone;
 *   • GET /scan/manifest — the event's tickets, in pages, then only what
 *     changed: a scan, an undo, a transfer, a refund, a cancelled order;
 *   • who gets names in that list, and the organizer's off switch.
 */

const TEST_ACCOUNT = `acct_test_offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = { profiles: [], events: [] };
let server; let baseUrl;
let tickets = [];
let ownerToken; let ownerDevice; let staffDevice; let pinDevice;

async function api(method, path, { body, token } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function person(label, role = 'attendee') {
  const email = `offline-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `${label[0].toUpperCase()}${label.slice(1)} Person`, role,
    password_hash: await hashPassword(PASSWORD),
    email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  ids.profiles.push(data.id);
  return { id: data.id, email };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const owner = await person('owner', 'organizer');
  const staff = await person('staff');
  const { data: org } = await supabase.from('organizers').insert({
    stripe_account_id: TEST_ACCOUNT, owner_user_id: owner.id, display_name: 'Offline Test Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: owner.id, terms_id: terms.id });

  const { data: ev, error: evErr } = await supabase.from('events').insert({
    organizer_id: org.id, country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
    terms_accepted_id: terms.id, purchase_mode: 'seat_only', city: 'Toronto', venue_name: 'Offline Hall',
    slug: `offline-test-${stamp}`, title: 'Offline Test Gala',
    starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86400e3 + 3 * 3600e3).toISOString(),
  }).select('id').single();
  if (evErr) throw new Error(evErr.message);
  ids.event = ev.id;
  ids.events.push(ev.id);
  const { data: map } = await supabase.from('venue_maps').insert({ event_id: ids.event, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ids.event, name: 'General Admission', price_cents: 2500 }).select('id').single();
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 5 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: 'C', seat_number: String(i + 1),
    })),
  ).select('id');
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: seats.map((s) => s.id), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Nora Offline', email: 'nora@eventsli-test.invalid' },
    p_stripe: { account_id: TEST_ACCOUNT, session_id: `cs_offline_${stamp}` },
  });
  ids.order = filled.data.order_id;
  tickets = await ticketSvc.forOrder(ids.order);

  // Doors open now.
  await supabase.from('events').update({
    starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  }).eq('id', ids.event);
  await supabase.from('event_staff').insert({ event_id: ids.event, user_id: staff.id, added_by: owner.id });

  const login = (email) => api('POST', '/auth/app/login', { body: { email, password: PASSWORD, deviceName: 'Offline test' } });
  ownerToken = (await login(owner.email)).body.data.token;
  const staffToken = (await login(staff.email)).body.data.token;
  ownerDevice = (await api('POST', '/scan/staff-login', { token: ownerToken, body: { eventId: ids.event } })).body.data.token;
  staffDevice = (await api('POST', '/scan/staff-login', { token: staffToken, body: { eventId: ids.event } })).body.data.token;
  const pin = await scanSvc.registerDevice({ eventId: ids.event, label: 'Offline door', pin: '553311' });
  pinDevice = (await scanSvc.authenticateDevice({ deviceId: pin.id, pin: '553311' })).token;
});

after(async () => {
  await supabase.from('scans').delete().eq('event_id', ids.event);
  await supabase.from('scan_devices').delete().eq('event_id', ids.event);
  await supabase.from('event_staff').delete().eq('event_id', ids.event);
  await supabase.from('event_gate_settings').delete().eq('event_id', ids.event);
  if (ids.order) {
    await supabase.from('tickets').delete().eq('order_id', ids.order);
    await supabase.from('order_items').delete().eq('order_id', ids.order);
    await supabase.from('orders').delete().eq('id', ids.order);
  }
  const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
  for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
  await supabase.from('reservations').delete().eq('event_id', ids.event);
  await supabase.from('seats').delete().eq('venue_map_id', ids.map);
  await supabase.from('venue_maps').delete().eq('event_id', ids.event);
  await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
  for (const id of ids.events) await supabase.from('events').delete().eq('id', id);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  for (const id of ids.profiles) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

/** Every page of a run, from `cursor` (or the start) until `done`. */
async function pullAll(token, cursor = null, limit = undefined) {
  const pages = [];
  let next = cursor;
  for (let i = 0; i < 20; i += 1) {
    const qs = new URLSearchParams({ ...(next ? { cursor: next } : {}), ...(limit ? { limit: String(limit) } : {}) });
    const res = await api('GET', `/scan/manifest?${qs}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    pages.push(res.body.data);
    next = res.body.data.cursor;
    if (res.body.data.done) break;
  }
  const rows = pages.flatMap((p) => p.rows);
  return { pages, rows, cursor: next, byId: new Map(rows.map((r) => [r.ticketId, r])) };
}

const futureCursor = (names) => Buffer.from(JSON.stringify({
  k: 1, s: new Date(Date.now() + 60_000).toISOString(), a: null, w: null, n: names,
})).toString('base64url');

// ── Keys and codes ──────────────────────────────────────────────────────────
test('new tickets carry QR v2 codes that verify with the key the door is given', async () => {
  const res = await api('GET', '/scan/keys', { token: pinDevice });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [jwk] = res.body.data.keys;
  assert.equal(jwk.kid, 'offline-test');
  assert.equal(jwk.d, undefined, 'no private part');

  const [h, p, s] = tickets[0].qr.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'offline-test' });
  // What a phone does with no signal: the public key, the code, nothing else.
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.equal(ok, true);
});

test('the keys need a door token', async () => {
  assert.equal((await api('GET', '/scan/keys')).status, 401);
  assert.equal((await api('GET', '/scan/manifest')).status, 401);
});

test('a v2 code and a legacy code both scan online', async () => {
  const v2 = await api('POST', '/scan/verify', { token: ownerDevice, body: { qr: tickets[4].qr } });
  assert.equal(v2.body.data.result, 'admitted', JSON.stringify(v2.body));
  const legacy = require('jsonwebtoken').sign(
    { typ: 'ticket', tid: tickets[4].id, eid: ids.event }, process.env.QR_JWT_SECRET, { algorithm: 'HS256' },
  );
  const again = await api('POST', '/scan/verify', { token: ownerDevice, body: { qr: legacy } });
  assert.equal(again.body.data.result, 'duplicate', 'the same ticket, read through its older code');
  await api('POST', '/scan/undo', { token: ownerDevice, body: { ticketId: tickets[4].id } });
});

// ── The list ────────────────────────────────────────────────────────────────
test('the first pull is the whole event, with everything a door decides on', async () => {
  const { pages, rows, byId } = await pullAll(ownerDevice);
  assert.equal(pages[0].reset, true, 'a first pull replaces whatever the phone had');
  assert.equal(rows.length, 5);
  assert.equal(byId.size, 5, 'no ticket twice');
  const row = byId.get(tickets[0].id);
  assert.deepEqual(Object.keys(row).sort(), ['holder', 'scannedAt', 'seat', 'status', 'table', 'ticketId', 'tier', 'v'].sort());
  assert.equal(row.status, 'valid');
  assert.equal(row.v, 0);
  assert.equal(row.tier, 'General Admission');
  assert.match(row.seat, /^Floor C\d$/);
  assert.equal(row.holder, 'Nora Offline', 'the organizer\'s own phone has names');
  assert.equal(pages.at(-1).event.status, 'published');
  assert.equal(pages.at(-1).gateLocked, false);
  assert.equal(pages.at(-1).legacyQrOffline, 'allow');
});

test('pages: a small page size walks every ticket exactly once', async () => {
  const { pages, byId, rows } = await pullAll(ownerDevice, null, 2);
  assert.deepEqual(pages.map((p) => p.done), [false, false, true]);
  assert.deepEqual(pages.map((p) => p.reset), [true, false, false], 'only the first page resets');
  assert.equal(rows.length, 5);
  assert.equal(byId.size, 5);
});

test('the next pull starts from the database clock, less a 30-second overlap', async () => {
  const { pages, cursor } = await pullAll(ownerDevice);
  const c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  const lag = Date.parse(pages[0].serverTime) - Date.parse(c.s);
  assert.ok(lag >= 29_000 && lag <= 31_000, `since lags the first page by ${lag} ms`);
  const nothing = await pullAll(ownerDevice, futureCursor(true));
  assert.equal(nothing.rows.length, 0, 'nothing changed after a later since');
  assert.equal(nothing.pages[0].reset, false);
});

test('a scan, an undo, a transfer and a refund all reach the next pull', async () => {
  const { cursor } = await pullAll(ownerDevice);

  await api('POST', '/scan/verify', { token: staffDevice, body: { qr: tickets[0].qr } });
  await supabase.from('tickets').update({ qr_version: 1 }).eq('id', tickets[1].id);
  await supabase.from('tickets').update({ status: 'void' }).eq('id', tickets[2].id);
  let delta = await pullAll(ownerDevice, cursor);
  assert.equal(delta.pages[0].reset, false);
  assert.equal(delta.byId.get(tickets[0].id).status, 'scanned');
  assert.ok(delta.byId.get(tickets[0].id).scannedAt, 'with when');
  assert.equal(delta.byId.get(tickets[1].id).v, 1, 'the old code is now the wrong version');
  assert.equal(delta.byId.get(tickets[2].id).status, 'void');

  await api('POST', '/scan/undo', { token: staffDevice, body: { ticketId: tickets[0].id } });
  delta = await pullAll(ownerDevice, delta.cursor);
  assert.equal(delta.byId.get(tickets[0].id).status, 'valid');

  await supabase.from('tickets').update({ status: 'valid' }).eq('id', tickets[2].id);
  await supabase.from('tickets').update({ qr_version: 0 }).eq('id', tickets[1].id);
});

test('names follow the organizer\'s setting, and changing it starts the list over', async () => {
  const off = await pullAll(staffDevice);
  assert.ok(off.rows.every((r) => r.holder === null), 'a door-team phone gets no names by default');
  const pinRows = await pullAll(pinDevice);
  assert.ok(pinRows.rows.every((r) => r.holder === null), 'nor does a shared tablet');

  const set = await api('PATCH', `/events/${ids.event}/gate-settings`, { token: ownerToken, body: { offlineShowNames: true } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const on = await pullAll(staffDevice, off.cursor);
  assert.equal(on.pages[0].reset, true, 'the old list had no names: replace it');
  assert.equal(on.rows.length, 5);
  assert.ok(on.rows.every((r) => r.holder === 'Nora Offline'));

  await api('PATCH', `/events/${ids.event}/gate-settings`, { token: ownerToken, body: { offlineShowNames: false } });
  const back = await pullAll(staffDevice, on.cursor);
  assert.equal(back.pages[0].reset, true, 'and taking names away wipes them too');
  assert.ok(back.rows.every((r) => r.holder === null));
});

test('a cursor that is not ours is a fresh start, not an error', async () => {
  const res = await api('GET', '/scan/manifest?cursor=not-a-cursor', { token: ownerDevice });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.reset, true);
});

test('the organizer switching offline check-in off takes the list away from every door', async () => {
  await api('PATCH', `/events/${ids.event}/gate-settings`, { token: ownerToken, body: { offlineAdmission: false } });
  try {
    for (const token of [ownerDevice, staffDevice, pinDevice]) {
      const res = await api('GET', '/scan/manifest', { token });
      assert.equal(res.status, 403);
      assert.equal(res.body.meta.reason, 'offline_admission_off');
    }
  } finally {
    await api('PATCH', `/events/${ids.event}/gate-settings`, { token: ownerToken, body: { offlineAdmission: true } });
  }
});

test('a cancelled order turns every one of its tickets void in the next pull', async () => {
  const { cursor } = await pullAll(ownerDevice);
  const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', ids.order);
  assert.equal(error, null);
  try {
    const delta = await pullAll(ownerDevice, cursor);
    assert.equal(delta.rows.length, 5, 'the order changed, so each of its tickets did');
    assert.ok(delta.rows.every((r) => r.status === 'void'));
    // And the door's online answer agrees with the list.
    const live = await api('POST', '/scan/verify', { token: ownerDevice, body: { qr: tickets[3].qr } });
    assert.equal(live.body.data.result, 'void');
  } finally {
    await supabase.from('orders').update({ status: 'paid' }).eq('id', ids.order);
  }
});

test('two doors let the same guest in offline: the organizer\'s door list flags it and can show only those', async () => {
  await api('POST', '/scan/verify', { token: pinDevice, body: { qr: tickets[2].qr } });
  const upload = await api('POST', '/scan/sync', {
    token: staffDevice,
    body: { scans: [{ qr: tickets[2].qr, clientScanId: `offline-conflict-${stamp}`, occurredAt: new Date().toISOString(), method: 'offline', offlineVerdict: 'admitted' }] },
  });
  assert.equal(upload.body.data.results[0].conflict, true, JSON.stringify(upload.body));

  const all = await api('GET', `/events/${ids.event}/attendees`, { token: ownerToken });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const flagged = all.body.data.filter((a) => a.conflict);
  assert.deepEqual(flagged.map((a) => a.ticketId), [tickets[2].id]);

  const only = await api('GET', `/events/${ids.event}/attendees?checkedIn=conflict`, { token: ownerToken });
  assert.deepEqual(only.body.data.map((a) => a.ticketId), [tickets[2].id]);
  assert.equal(only.body.pagination.total, 1);
});
