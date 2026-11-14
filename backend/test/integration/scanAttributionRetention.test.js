const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const ticketSvc = require('../../services/ticketService');
const retention = require('../../services/scanRetention');
const { hashPassword } = require('../../utils/crypto');

/**
 * Privacy remediation (mobile/store/PRIVACY-AUDIT-FINAL.md, migration
 * 20261118090000):
 *
 *   • ATTRIBUTION — scans held offline on a phone and uploaded after a
 *     colleague signed in stay under the device that took them; the uploader
 *     is recorded separately. Never a device of another event.
 *   • RETENTION — scan_retention(): a dry run changes nothing; holds, open
 *     disputes and conflicts are kept; the ticket keeps its own scanned_at.
 *
 * Every retention call here is scoped to this file's event, so a local
 * database's other events are never touched.
 */

const TEST_ACCOUNT = `acct_test_retain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = { profiles: [], events: [] };
let server; let baseUrl;
let tickets = [];
const door = {};

async function api(method, path, { body, token } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function person(label, role = 'attendee') {
  const email = `retain-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `${label} Person`, role,
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
  const amira = await person('amira');
  const ben = await person('ben');
  const { data: org } = await supabase.from('organizers').insert({
    stripe_account_id: TEST_ACCOUNT, owner_user_id: owner.id, display_name: 'Retention Test Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: owner.id, terms_id: terms.id });

  const mkEvent = async (slug) => {
    const { data: ev, error } = await supabase.from('events').insert({
      organizer_id: org.id, country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
      terms_accepted_id: terms.id, purchase_mode: 'seat_only', city: 'Toronto', venue_name: 'Retention Hall',
      slug: `${slug}-${stamp}`, title: `Retention ${slug}`,
      starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
      ends_at: new Date(Date.now() + 2 * 86400e3 + 3 * 3600e3).toISOString(),
    }).select('id').single();
    if (error) throw new Error(error.message);
    ids.events.push(ev.id);
    return ev.id;
  };
  ids.event = await mkEvent('retain');
  ids.other = await mkEvent('retain-other');

  const { data: map } = await supabase.from('venue_maps').insert({ event_id: ids.event, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ids.event, name: 'General Admission', price_cents: 2500 }).select('id').single();
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 6 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: 'R', seat_number: String(i + 1),
    })),
  ).select('id');
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: seats.map((s) => s.id), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Rita Retain', email: 'rita@eventsli-test.invalid' },
    p_stripe: { account_id: TEST_ACCOUNT, session_id: `cs_retain_${stamp}` },
  });
  ids.order = filled.data.order_id;
  tickets = await ticketSvc.forOrder(ids.order);

  await supabase.from('events').update({
    starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  }).eq('id', ids.event);
  await supabase.from('event_staff').insert([
    { event_id: ids.event, user_id: amira.id, added_by: owner.id },
    { event_id: ids.event, user_id: ben.id, added_by: owner.id },
    { event_id: ids.other, user_id: ben.id, added_by: owner.id },
  ]);

  const login = async (p) => (await api('POST', '/auth/app/login', { body: { email: p.email, password: PASSWORD, deviceName: 'Retention test' } })).body.data.token;
  const staffLogin = async (token, eventId) => (await api('POST', '/scan/staff-login', { token, body: { eventId } })).body.data;
  const amiraAcct = await login(amira);
  const benAcct = await login(ben);
  door.amira = await staffLogin(amiraAcct, ids.event);
  door.ben = await staffLogin(benAcct, ids.event);
  door.benOther = await staffLogin(benAcct, ids.other);
  assert.ok(door.amira.device.id && door.ben.device.id && door.benOther.device.id);
  assert.notEqual(door.amira.device.id, door.ben.device.id);
});

after(async () => {
  for (const id of ids.events) {
    await supabase.from('scans').delete().eq('event_id', id);
    await supabase.from('scan_retention_holds').delete().eq('event_id', id);
    await supabase.from('scan_devices').delete().eq('event_id', id);
    await supabase.from('event_staff').delete().eq('event_id', id);
    await supabase.from('event_gate_settings').delete().eq('event_id', id);
  }
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

const scanRow = async (clientScanId) => (await supabase.from('scans')
  .select('device_id, uploaded_by_device_id, result').eq('client_scan_id', clientScanId).single()).data;
const upload = (token, scans) => api('POST', '/scan/sync', { token, body: { scans } });
const offline = (ticket, clientScanId, extra = {}) => ({
  qr: ticket.qr, clientScanId, occurredAt: new Date(Date.now() - 60_000).toISOString(),
  method: 'offline', offlineVerdict: 'admitted', ...extra,
});

// ── Attribution ──────────────────────────────────────────────────────────────

test("Amira's offline scans, uploaded from Ben's session, stay Amira's; Ben is the uploader", async () => {
  const id = `amira-held-${stamp}`;
  const res = await upload(door.ben.token, [offline(tickets[0], id, { scannedByDeviceId: door.amira.device.id })]);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results[0].result, 'admitted');
  const row = await scanRow(id);
  assert.equal(row.device_id, door.amira.device.id);
  assert.equal(row.uploaded_by_device_id, door.ben.device.id);
});

test('a device of ANOTHER event, or an unknown one, is ignored: the scan stays with the uploader', async () => {
  for (const [n, claimed] of [[1, door.benOther.device.id], [2, randomUUID()], [3, 'not-a-uuid']]) {
    const id = `foreign-${n}-${stamp}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await upload(door.ben.token, [offline(tickets[n], id, { scannedByDeviceId: claimed })]);
    assert.equal(res.status, 200);
    // eslint-disable-next-line no-await-in-loop
    const row = await scanRow(id);
    assert.equal(row.device_id, door.ben.device.id, `claim ${n}`);
    assert.equal(row.uploaded_by_device_id, null, `claim ${n}`);
  }
});

test('a replay of an attributed scan changes nothing, whoever uploads it', async () => {
  const id = `amira-held-${stamp}`;
  const res = await upload(door.amira.token, [offline(tickets[0], id, { scannedByDeviceId: door.ben.device.id })]);
  assert.equal(res.status, 200);
  const row = await scanRow(id);
  assert.equal(row.device_id, door.amira.device.id);
  assert.equal(row.uploaded_by_device_id, door.ben.device.id);
});

test('an older app that sends no device keeps the old behaviour', async () => {
  const id = `legacy-${stamp}`;
  await upload(door.ben.token, [offline(tickets[4], id)]);
  const row = await scanRow(id);
  assert.equal(row.device_id, door.ben.device.id);
  assert.equal(row.uploaded_by_device_id, null);
});

// ── Retention ────────────────────────────────────────────────────────────────

async function endEventDaysAgo(days) {
  const end = Date.now() - days * 86400e3;
  await supabase.from('events').update({
    starts_at: new Date(end - 3 * 3600e3).toISOString(), ends_at: new Date(end).toISOString(),
  }).eq('id', ids.event);
}
const countScans = async (conflict) => (await supabase.from('scans').select('id', { count: 'exact', head: true })
  .eq('event_id', ids.event).eq('conflict', conflict)).count;

test('retention: an event inside the window is not due', async () => {
  await endEventDaysAgo(10);
  const r = await retention.run({ days: 90, dryRun: true, eventIds: [ids.event] });
  assert.equal(r.events, 0);
});

test('retention: a dry run reports and deletes nothing', async () => {
  // One conflict row (let in twice offline), written as the server would.
  await supabase.from('scans').insert({
    ticket_id: tickets[5].ticketId || tickets[5].id, event_id: ids.event, device_id: door.ben.device.id,
    result: 'admitted', method: 'offline', conflict: true, client_scan_id: `conflict-${stamp}`,
  });
  await endEventDaysAgo(100);
  const before = await countScans(false);
  assert.ok(before >= 5);
  const r = await retention.run({ days: 90, dryRun: true, eventIds: [ids.event] });
  assert.equal(r.events, 1);
  assert.equal(r.eligible, before);
  assert.equal(r.conflictsKept, 1);
  assert.equal(r.deleted, 0);
  assert.equal(await countScans(false), before);
});

test('retention: a hold, then an open card dispute, each keep the whole log', async () => {
  await supabase.from('scan_retention_holds').insert({ event_id: ids.event, reason: 'Insurance claim, ref 42', created_by: 'test' });
  let r = await retention.run({ days: 90, dryRun: false, eventIds: [ids.event] });
  assert.match(r.held[0].because, /retention hold: Insurance claim/);
  assert.equal(r.deleted, 0);
  await supabase.from('scan_retention_holds').delete().eq('event_id', ids.event);

  await supabase.from('orders').update({ dispute_status: 'needs_response' }).eq('id', ids.order);
  r = await retention.run({ days: 90, dryRun: false, eventIds: [ids.event] });
  assert.equal(r.held[0].because, 'open card dispute');
  assert.equal(r.deleted, 0);
  await supabase.from('orders').update({ dispute_status: 'won' }).eq('id', ids.order);
  assert.ok(await countScans(false) >= 5);
});

test('retention: executing deletes the log, keeps conflicts, and the ticket keeps scanned_at', async () => {
  const r = await retention.run({ days: 90, dryRun: false, eventIds: [ids.event] });
  assert.ok(r.deleted >= 5);
  assert.equal(await countScans(false), 0);
  assert.equal(await countScans(true), 1);
  const { data: t } = await supabase.from('tickets').select('scanned_at').eq('order_id', ids.order).not('scanned_at', 'is', null);
  assert.ok(t.length >= 1, 'the admission itself is still on the ticket');
  const { data: runs } = await supabase.from('scan_retention_runs').select('dry_run, scans_deleted').order('id', { ascending: false }).limit(1);
  assert.deepEqual(runs[0], { dry_run: false, scans_deleted: r.deleted });
});

test('retention: fewer than 30 days is refused by the database', async () => {
  await assert.rejects(retention.run({ days: 7, dryRun: true, eventIds: [ids.event] }), /at least 30/);
});
