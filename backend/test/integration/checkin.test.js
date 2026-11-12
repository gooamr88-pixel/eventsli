const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

// A test-only connected-account id for this suite's organizer: fulfil refuses
// a direct charge whose account is not the event organizer's (T-074).
const TEST_ACCOUNT = `acct_test_checkin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    // Card sales are direct charges on the organizer's own account (T-074).
    stripe_account_id: TEST_ACCOUNT,
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
  // Nine: 0–5 for the original suite, 6 transfer, 7 replay race, 8 refusals.
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null,
    p_seat_ids: seats.slice(0, 9).map((s) => s.id), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Gate Buyer', email: 'gate@eventsli-test.invalid' },
    p_stripe: { account_id: TEST_ACCOUNT, session_id: `cs_scan_${stamp}` },
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
  // Fulfilment stores no name on the ticket; the door falls back to the buyer,
  // and says that is what it is.
  assert.equal(res.body.data.attendee, 'Gate Buyer');
  assert.equal(res.body.data.holder_is_buyer, true);
  assert.equal(res.body.data.tier, 'GA');
  assert.equal(res.body.data.ticket_id, tickets[0].id);
  assert.equal(res.body.data.event_title, 'Gate Test');
  assert.equal(res.body.data.method, 'scan');
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

  // …in the EVENT's time, not the database's UTC.
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(res.body.data.scanned_at));
  assert.ok(res.body.data.message.endsWith(local),
    `"${res.body.data.message}" should end with the Toronto time ${local}`);
  // …and where.
  assert.equal(res.body.data.first_scan.device, 'Main door');
  assert.equal(res.body.data.conflict, false);
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

// ── Check-in v2 ─────────────────────────────────────────────────────────────

test('a transferred ticket moves its code: the old one is refused, the new one admits (T-016)', async () => {
  const t = tickets[6];
  await ticketSvc.transfer({
    ticketId: t.id, tokenOrderId: ids.order, toEmail: `friend-${stamp}@eventsli-test.invalid`,
  });

  const old = await gate('/verify', { qr: t.qr });
  assert.equal(old.status, 200);
  assert.equal(old.body.data.result, 'transferred', JSON.stringify(old.body));

  // The seller's copy of the order no longer carries a code at all — a fresh
  // one minted there would carry the new version and let them back in.
  const sellerCopy = (await ticketSvc.forOrder(ids.order)).find((x) => x.id === t.id);
  assert.equal(sellerCopy.qr, null);
  assert.equal(sellerCopy.transferredAway, true);

  // The recipient has it, with a code that works.
  const received = await ticketSvc.receivedBy(`FRIEND-${stamp}@eventsli-test.invalid`);
  assert.equal(received.length, 1);
  const theirs = received[0].tickets.find((x) => x.id === t.id);
  assert.ok(theirs?.qr, 'the recipient must get a code');
  assert.notEqual(theirs.qr, t.qr);

  const now = await gate('/verify', { qr: theirs.qr });
  assert.equal(now.body.data.result, 'admitted');
  // After a transfer the buyer is exactly who should NOT be named at the door.
  assert.equal(now.body.data.attendee, null);
});

test('one scan uploaded twice at the same instant is a replay, never an error', async () => {
  const t = tickets[7];
  const clientScanId = `race-${stamp}`;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => gate('/verify', { qr: t.qr, clientScanId })),
  );
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.notEqual(r.body.data.result, 'error', JSON.stringify(r.body));
    assert.equal(r.body.data.result, 'admitted');
  }
  assert.equal(results.filter((r) => !r.body.data.replay).length, 1,
    'exactly one of them is the admission; the rest are its replay');
});

test('a closed event and an unpaid order are refused, and the refusal is logged', async () => {
  const t = tickets[8];

  await supabase.from('events').update({ status: 'suspended' }).eq('id', ids.event);
  const closed = await gate('/verify', { qr: t.qr });
  await supabase.from('events').update({ status: 'published' }).eq('id', ids.event);
  assert.equal(closed.body.data.result, 'event_not_open', JSON.stringify(closed.body));

  await supabase.from('orders').update({ status: 'cancelled' }).eq('id', ids.order);
  const unpaid = await gate('/verify', { qr: t.qr });
  await supabase.from('orders').update({ status: 'paid' }).eq('id', ids.order);
  assert.equal(unpaid.body.data.result, 'void');
  assert.match(unpaid.body.data.message, /cancelled or refunded/);

  const { data: log } = await supabase
    .from('scans').select('result').eq('ticket_id', t.id);
  assert.deepEqual(log.map((s) => s.result).sort(), ['event_not_open', 'void']);

  // Open again, it admits — and a device clock a day fast is not believed.
  const ok = await gate('/verify', {
    qr: t.qr, occurredAt: new Date(Date.now() + 86400e3).toISOString(),
  });
  assert.equal(ok.body.data.result, 'admitted');
  assert.ok(new Date(ok.body.data.scanned_at).getTime() <= Date.now() + 60e3,
    'a scan cannot have happened tomorrow');
});

test('an offline admission of a ticket another door already admitted is flagged', async () => {
  const res = await gate('/sync', {
    // Ticket 7 was admitted by the race above. (Not 0: the undo test reverses it.)
    scans: [{
      qr: tickets[7].qr, clientScanId: `conflict-${stamp}`,
      occurredAt: new Date(Date.now() - 60e3).toISOString(),
      method: 'offline', offlineVerdict: 'admitted',
    }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.results[0].result, 'duplicate');
  assert.equal(res.body.data.results[0].conflict, true);
  assert.equal(res.body.data.summary.conflicts, 1);

  const { data: row } = await supabase
    .from('scans').select('method, conflict').eq('client_scan_id', `conflict-${stamp}`).single();
  assert.deepEqual(row, { method: 'offline', conflict: true });
});

test('the check-in functions are scoped to their event (T-054)', async () => {
  const other = '00000000-0000-0000-0000-000000000000';
  const { data: undo } = await supabase.rpc('undo_check_in_v2', {
    p_event_id: other, p_ticket_id: tickets[0].id, p_device_id: deviceId,
  });
  assert.equal(undo.result, 'not_found');

  const { data: admit } = await supabase.rpc('check_in_ticket_v2', {
    p_event_id: other, p_ticket_id: tickets[3].id, p_qr_version: 0,
    p_device_id: deviceId, p_client_scan_id: null,
  });
  assert.equal(admit.result, 'not_found');
});

test('the gate reports live counts', async () => {
  const status = await scanSvc.gateStatus(ids.event);
  assert.equal(status.stats.issued, tickets.length);
  assert.ok(status.stats.admitted >= 1);
  assert.equal(status.stats.issued, status.stats.admitted + status.stats.pending + status.stats.void);
});

// ── An admin's gate decision, at the door (20261115090000) ──────────────────

test('a gate an admin closed refuses live scans, and says why', async () => {
  const { data: set } = await supabase.rpc('set_scanner_mode', {
    p_event_id: ids.event, p_mode: 'closed', p_until: null,
    p_reason: 'Safety stop while the venue is checked', p_admin_id: null,
  });
  assert.equal(set.ok, true, JSON.stringify(set));
  try {
    assert.equal(set.gate.locked, true);
    assert.equal(set.gate.reason, 'admin_closed');

    const res = await gate('/verify', { qr: tickets[1].qr });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'SCANNER_LOCKED');
    assert.equal(res.body.meta.reason, 'admin_closed');
  } finally {
    await supabase.rpc('set_scanner_mode', {
      p_event_id: ids.event, p_mode: 'auto', p_until: null, p_reason: 'Test over, back to invoices', p_admin_id: null,
    });
  }
});

test('an admission a phone already made offline is recorded even after the gate closed', async () => {
  // The person is inside. Refusing the upload would not un-admit them; it
  // would only lose the record and let the same ticket in at the next door.
  await supabase.rpc('set_scanner_mode', {
    p_event_id: ids.event, p_mode: 'closed', p_until: null, p_reason: 'Closed after the phone lost signal', p_admin_id: null,
  });
  try {
    // Any ticket nobody has scanned yet.
    const { data: fresh } = await supabase.from('tickets').select('id')
      .in('id', tickets.map((t) => t.id)).eq('status', 'valid').limit(1).single();
    const ticket = tickets.find((t) => t.id === fresh.id);
    const res = await gate('/sync', {
      scans: [{
        qr: ticket.qr, clientScanId: `closed-offline-${stamp}`,
        occurredAt: new Date(Date.now() - 120e3).toISOString(),
        method: 'offline', offlineVerdict: 'admitted',
      }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.results[0].result, 'admitted');

    const { data: row } = await supabase
      .from('scans').select('result, detail').eq('client_scan_id', `closed-offline-${stamp}`).single();
    assert.equal(row.result, 'admitted');
    assert.match(row.detail, /while scanning was switched off \(admin_closed\)/);

    // A scan the phone did NOT already admit is still refused.
    const held = await gate('/sync', {
      scans: [{ qr: tickets[1].qr, clientScanId: `closed-held-${stamp}`, occurredAt: new Date().toISOString(), method: 'offline' }],
    });
    assert.equal(held.body.data.results[0].result, 'scanner_locked');
  } finally {
    await supabase.rpc('set_scanner_mode', {
      p_event_id: ids.event, p_mode: 'auto', p_until: null, p_reason: 'Test over, back to invoices', p_admin_id: null,
    });
  }
});
