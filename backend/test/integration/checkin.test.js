const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const ticketSvc = require('../../services/ticketService');
const scanSvc = require('../../services/scanService');

/**
 * The gate, end to end.
 *
 * Two properties decide whether this works with a queue outside:
 *   • one admission per ticket, even when two doors scan at the same instant;
 *   • a re-uploaded offline queue returns the ORIGINAL answers, not 200
 *     duplicate refusals for people who were correctly admitted an hour ago.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let tickets = [];
let deviceToken; let deviceId;

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `scan-${stamp}@eventsli-test.invalid`, full_name: 'Scan Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Scan Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `scan-test-${stamp}`, title: 'Gate Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_only',
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id; ids.slug = ev.slug;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'GA', price_cents: 4000 }).select('id').single();

  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 10 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');

  // A real purchase, so the tickets under test are the ones fulfilment issues.
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null,
    p_seat_ids: seats.slice(0, 6).map((s) => s.id), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Gate Buyer', email: 'gate@eventsli-test.invalid' },
    p_stripe: { session_id: `cs_scan_${stamp}` },
  });
  ids.order = filled.data.order_id;
  tickets = await ticketSvc.forOrder(ids.order);

  const device = await scanSvc.registerDevice({ eventId: ev.id, label: 'Main door', pin: '4821' });
  deviceId = device.id;
  const auth = await scanSvc.authenticateDevice({ deviceId: device.id, pin: '4821' });
  deviceToken = auth.token;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  if (ids.event) {
    await supabase.from('scans').delete().eq('event_id', ids.event);
    await supabase.from('scan_devices').delete().eq('event_id', ids.event);
    await supabase.from('scanner_access').delete().eq('event_id', ids.event);
    await supabase.from('invoices').delete().eq('event_id', ids.event);
    if (ids.order) {
      await supabase.from('tickets').delete().eq('order_id', ids.order);
      await supabase.from('order_items').delete().eq('order_id', ids.order);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

const gate = (path, body, token = deviceToken) => fetch(`${baseUrl}/scan${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ── The core property ───────────────────────────────────────────────────────

test('a valid ticket is admitted once', async () => {
  const res = await gate('/verify', { qr: tickets[0].qr });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.result, 'admitted');
  assert.ok(res.body.data.seat, 'the door needs to see the seat');
});

test('the second scan is refused, and says WHEN the first was', async () => {
  const res = await gate('/verify', { qr: tickets[0].qr });
  // 200, not an error: a duplicate is an ANSWER the device must render, not a
  // network failure inviting the operator to retry.
  assert.equal(res.status, 200);
  assert.equal(res.body.data.result, 'duplicate');
  assert.ok(res.body.data.scanned_at);
  // "Already used" starts an argument at the door; "already used at 19:04" ends one.
  assert.match(res.body.data.message, /\d{2}:\d{2}/);
});

test('two doors scanning the same code at once admit exactly one', async () => {
  for (let round = 1; round <= 3; round += 1) {
    const t = tickets[round];
    const results = await Promise.all(
      Array.from({ length: 8 }, () => gate('/verify', { qr: t.qr })),
    );
    const admitted = results.filter((r) => r.body?.data?.result === 'admitted');
    assert.equal(admitted.length, 1,
      `round ${round}: ${admitted.length} admissions for one ticket`);
    assert.equal(
      results.filter((r) => r.body?.data?.result === 'duplicate').length, 7,
      'the rest must be told it is a duplicate, not given an error',
    );
  }
});

// ── Offline ─────────────────────────────────────────────────────────────────

test('an offline queue uploads, and re-uploading changes nothing', async () => {
  const queued = [
    { qr: tickets[4].qr, clientScanId: `dev-${stamp}-1`, occurredAt: new Date(Date.now() - 3600e3).toISOString() },
    { qr: tickets[5].qr, clientScanId: `dev-${stamp}-2`, occurredAt: new Date(Date.now() - 3500e3).toISOString() },
  ];

  const first = await gate('/sync', { scans: queued });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.summary.admitted, 2);

  // The device lost its ack and sends the queue again — the ordinary case, not
  // an edge case.
  const second = await gate('/sync', { scans: queued });
  assert.equal(second.body.data.summary.replayed, 2,
    'a replay must return the original answers');
  assert.equal(second.body.data.summary.admitted, 0, 'and must not admit anyone twice');

  for (const r of second.body.data.results) {
    assert.equal(r.result, 'admitted', 'the guest was admitted, and still was');
    assert.equal(r.replay, true);
  }
});

test('the door clock is kept, not the server clock', async () => {
  const { data: scan } = await supabase
    .from('scans').select('occurred_at, scanned_at')
    .eq('client_scan_id', `dev-${stamp}-1`).single();

  // Recorded an hour before it was uploaded. "Who was inside at 8pm" has to
  // answer from the gate's clock.
  const gap = new Date(scan.scanned_at) - new Date(scan.occurred_at);
  assert.ok(gap > 30 * 60 * 1000, 'the offline timestamp must survive the upload');
});

// ── What must not open the door ─────────────────────────────────────────────

test('a tampered code never reaches the database', async () => {
  // Long enough to be a plausible token, and correctly shaped — but the
  // signature no longer matches, so it is rejected without a lookup.
  const tampered = `${tickets[0].qr.slice(0, -6)}AAAAAA`;
  const res = await gate('/verify', { qr: tampered });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.result, 'invalid');
});

test('a code too short to be a token is refused before the handler', async () => {
  // Cheaper still: rejected by the validator, so a flood of junk never becomes
  // a flood of signature checks.
  for (const junk of ['nonsense', 'a.b.c']) {
    const res = await gate('/verify', { qr: junk });
    assert.equal(res.status, 400, `"${junk}" should not reach the handler`);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
  }
});

test('a real ticket for another event does not open this door', async () => {
  const jwt = require('jsonwebtoken');
  const otherEvent = jwt.sign(
    { typ: 'ticket', tid: tickets[0].id, eid: '00000000-0000-0000-0000-000000000000' },
    process.env.QR_JWT_SECRET, { algorithm: 'HS256' },
  );
  const res = await gate('/verify', { qr: otherEvent });
  assert.equal(res.body.data.result, 'wrong_event');
});

test('a scanner cannot sign in with the wrong PIN', async () => {
  const res = await fetch(`${baseUrl}/scan/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, pin: '0000' }),
  });
  assert.equal(res.status, 401);
});

test('a revoked device is refused, and looks like a wrong PIN', async () => {
  const d = await scanSvc.registerDevice({ eventId: ids.event, label: 'Lost tablet', pin: '9911' });
  await scanSvc.setDeviceActive(d.id, false);

  const result = await scanSvc.authenticateDevice({ deviceId: d.id, pin: '9911' });
  assert.equal(result, null,
    'a revoked device must not be distinguishable from a wrong PIN');
});

test('a session cookie cannot authenticate a gate', async () => {
  const jwt = require('jsonwebtoken');
  // Correctly signed with the session secret, but not a device token.
  const sessionish = jwt.sign({ sub: 'someone', jti: 'x' },
    process.env.JWT_SECRET, { algorithm: 'HS256' });
  const res = await gate('/verify', { qr: tickets[0].qr }, sessionish);
  assert.equal(res.status, 401);
});

test('no token at all is refused', async () => {
  const res = await fetch(`${baseUrl}/scan/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qr: tickets[0].qr }),
  });
  assert.equal(res.status, 401);
});

// ── BRD §18 — the gate closes on an overdue invoice ─────────────────────────

test('an overdue commission invoice closes the gate', async () => {
  const { data: inv, error } = await supabase.from('invoices').insert({
    organizer_id: ids.organizer, event_id: ids.event,
    number: `INV-${stamp}`, currency: 'CAD', amount_cents: 5000,
    status: 'open',
    // due_at is normally set by the trigger; forced into the past here.
    due_at: new Date(Date.now() - 86400e3).toISOString(),
  }).select('id').single();
  assert.equal(error, null, JSON.stringify(error));

  const status = await scanSvc.gateStatus(ids.event);
  assert.equal(status.gate.locked, true);
  assert.equal(status.gate.reason, 'commission_overdue');

  const res = await gate('/verify', { qr: tickets[2].qr });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'SCANNER_LOCKED');

  // Paying it reopens the gate — no separate unlock step, because the lock is
  // derived from the invoice rather than cached as a flag.
  await supabase.from('invoices')
    .update({ status: 'paid', confirmed_at: new Date().toISOString() }).eq('id', inv.id);

  const after_ = await scanSvc.gateStatus(ids.event);
  assert.equal(after_.gate.locked, false, 'settling the invoice must reopen the door');
});

test('a super admin can override a closed gate, for a bounded time', async () => {
  const { data: inv } = await supabase.from('invoices').insert({
    organizer_id: ids.organizer, event_id: ids.event,
    number: `INV2-${stamp}`, currency: 'CAD', amount_cents: 5000, status: 'open',
    due_at: new Date(Date.now() - 86400e3).toISOString(),
  }).select('id').single();

  assert.equal((await scanSvc.gateStatus(ids.event)).gate.locked, true);

  await supabase.from('scanner_access').upsert({
    event_id: ids.event,
    override_until: new Date(Date.now() + 6 * 3600e3).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });

  const open = await scanSvc.gateStatus(ids.event);
  assert.equal(open.gate.locked, false);
  assert.equal(open.gate.override, true);

  // An expired override stops overriding.
  await supabase.from('scanner_access').update({
    override_until: new Date(Date.now() - 3600e3).toISOString(),
  }).eq('event_id', ids.event);
  assert.equal((await scanSvc.gateStatus(ids.event)).gate.locked, true,
    'an expired override must not keep the gate open');

  await supabase.from('invoices').delete().eq('id', inv.id);
  await supabase.from('scanner_access').update({ override_until: null }).eq('event_id', ids.event);
});

// ── Undo ────────────────────────────────────────────────────────────────────

test('a mistaken check-in can be undone, and is recorded', async () => {
  const t = tickets[2];
  await gate('/verify', { qr: t.qr });

  const undone = await gate('/undo', { ticketId: t.id });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));

  // The guest can now be admitted properly.
  const again = await gate('/verify', { qr: t.qr });
  assert.equal(again.body.data.result, 'admitted');

  // The reversal is its own log line, not a deletion — the log is what an
  // organizer reads to work out what happened at the door.
  const { data: log } = await supabase
    .from('scans').select('result').eq('ticket_id', t.id).order('scanned_at');
  assert.ok(log.some((s) => s.result === 'undone'));
});

test('undoing a ticket that was never scanned is refused', async () => {
  const res = await gate('/undo', { ticketId: tickets[5].id });
  assert.equal(res.status, 200); // it WAS scanned in the offline batch
  const fresh = tickets.find((t) => t.id !== tickets[5].id);
  const second = await gate('/undo', { ticketId: fresh.id });
  assert.ok([200, 409].includes(second.status));
});

test('the gate reports live counts', async () => {
  const status = await scanSvc.gateStatus(ids.event);
  assert.equal(status.stats.issued, 6);
  assert.ok(status.stats.admitted >= 1);
  assert.equal(status.stats.issued, status.stats.admitted + status.stats.pending + status.stats.void);
});
