const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const ticketSvc = require('../../services/ticketService');

/**
 * Fulfilment against the real database.
 *
 * Stripe itself is not called — the risky parts are not the API call, they are
 * what happens around it: whether a retried webhook creates a second order,
 * whether a failed fulfilment leaves seats stranded, whether the ledger adds up.
 * Those are all exercised directly against `fulfill_checkout`, which is what the
 * webhook and the success page both funnel into.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let tableId; let seatIds = [];

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `ful-${stamp}@eventsli-test.invalid`, full_name: 'Ful Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Ful Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `ful-test-${stamp}`, title: 'Fulfilment Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
    commission_pct: 1.5, commission_tax_pct: 13, event_tax_pct: 13,
    payment_fee_mode: 'auto', fee_bearer: 'buyer',
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id; ids.slug = ev.slug;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;

  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'Standard', price_cents: 5000 }).select('id').single();
  ids.tier = tier.id;

  const { data: t } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'Main', seat_count: 8, price_cents: 36000,
  }).select('id').single();
  tableId = t.id;

  const rows = Array.from({ length: 8 }, (_, i) => ({
    venue_map_id: map.id, table_id: t.id, tier_id: tier.id,
    section_key: 'Main', row_label: 'A', seat_number: String(i + 1),
  }));
  const { data: s } = await supabase.from('seats').insert(rows).select('id');
  seatIds = s.map((r) => r.id);
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  if (ids.event) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ids.event);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    const { data: res } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of res || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('tables').delete().eq('venue_map_id', ids.map);
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

const holdSeats = (s) => supabase.rpc('hold_seats', {
  p_event_id: ids.event, p_user_id: null, p_seat_ids: s, p_ttl_minutes: 35,
});
const holdTable = (t) => supabase.rpc('hold_table', {
  p_event_id: ids.event, p_user_id: null, p_table_id: t, p_ttl_minutes: 35,
});

const fulfill = (reservationId, breakdown) => supabase.rpc('fulfill_checkout', {
  p_reservation_id: reservationId,
  p_channel: 'stripe',
  p_breakdown: breakdown,
  p_buyer: { user_id: null, name: 'Test Buyer', email: 'buyer@eventsli-test.invalid', phone: null },
  p_stripe: { session_id: `cs_test_${Math.random().toString(36).slice(2)}`, payment_intent_id: null },
});

// ── The quote ───────────────────────────────────────────────────────────────

test('the quote is computed from the held seats, not from the client', async () => {
  const held = await holdSeats([seatIds[0], seatIds[1]]);
  assert.equal(held.data.ok, true);

  const q = await pricing.quoteReservation(held.data.reservation_id);

  assert.equal(q.breakdown.subtotalCents, 10000);   // 2 × $50 from the tier
  assert.equal(q.breakdown.eventTaxCents, 1300);
  assert.equal(q.breakdown.commissionCents, 150);   // 1.5%
  assert.equal(q.breakdown.commissionTaxCents, 20); // 13% of the commission
  assert.equal(q.admits, 2);

  // auto mode: the fee is whatever Stripe will actually bill.
  assert.equal(q.breakdown.paymentFeeCents, q.breakdown.stripeCostCents);
  assert.equal(q.breakdown.platformNetCents, q.breakdown.intendedMarginCents);

  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

test('a whole table quotes at the table price and admits everyone on it', async () => {
  const held = await holdTable(tableId);
  const q = await pricing.quoteReservation(held.data.reservation_id);

  assert.equal(q.breakdown.subtotalCents, 36000, 'the table price, not 8 × $50');
  assert.equal(q.admits, 8, 'eight people walk in on one line item');

  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

test('the buyer only sees the service fee when they are paying it', async () => {
  const held = await holdSeats([seatIds[0]]);
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const buyerPays = pricing.publicBreakdown(q);
  assert.ok(buyerPays.lines.some((l) => l.label === 'Service fee'));

  await supabase.from('events').update({ fee_bearer: 'organizer' }).eq('id', ids.event);
  const q2 = await pricing.quoteReservation(held.data.reservation_id);
  const orgPays = pricing.publicBreakdown(q2);
  assert.equal(orgPays.lines.some((l) => l.label === 'Service fee'), false,
    'a zero "Service fee" line on the receipt only raises questions');
  assert.ok(orgPays.totalCents < buyerPays.totalCents);

  await supabase.from('events').update({ fee_bearer: 'buyer' }).eq('id', ids.event);
  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

test('an expired hold cannot be quoted', async () => {
  const held = await holdSeats([seatIds[0]]);
  await supabase.from('reservations')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', held.data.reservation_id);

  await assert.rejects(
    () => pricing.quoteReservation(held.data.reservation_id),
    (e) => e.code === 'RESERVATION_EXPIRED',
  );
  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

// ── Fulfilment ──────────────────────────────────────────────────────────────

test('fulfilment creates the order, the tickets, and sells the stock', async () => {
  const held = await holdSeats([seatIds[2], seatIds[3]]);
  const q = await pricing.quoteReservation(held.data.reservation_id);

  const res = await fulfill(held.data.reservation_id, q.breakdown);
  if (res.error) console.error('RPCERR', JSON.stringify(res.error));
  assert.equal(res.data?.ok, true, JSON.stringify(res.data || res.error));
  assert.equal(res.data.ticket_count, 2);

  const { data: order } = await supabase.from('orders')
    .select('*').eq('id', res.data.order_id).single();
  assert.equal(order.status, 'paid');
  assert.equal(order.buyer_total_cents, q.breakdown.buyerTotalCents);
  assert.equal(order.commission_cents, 150);

  const { data: seats } = await supabase.from('seats')
    .select('status').in('id', [seatIds[2], seatIds[3]]);
  assert.ok(seats.every((s) => s.status === 'sold'));

  const { data: reservation } = await supabase.from('reservations')
    .select('state').eq('id', held.data.reservation_id).single();
  assert.equal(reservation.state, 'converted');
});

test('a retried webhook returns the same order, not a second one', async () => {
  const held = await holdSeats([seatIds[4]]);
  const q = await pricing.quoteReservation(held.data.reservation_id);

  const first = await fulfill(held.data.reservation_id, q.breakdown);
  assert.equal(first.data.ok, true);

  // Stripe redelivers as a matter of course, not as an edge case.
  const second = await fulfill(held.data.reservation_id, q.breakdown);
  assert.equal(second.data.ok, true);
  assert.equal(second.data.already_fulfilled, true);
  assert.equal(second.data.order_id, first.data.order_id);

  const { count } = await supabase.from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', held.data.reservation_id);
  assert.equal(count, 1, 'exactly one order per reservation, however many deliveries');
});

test('concurrent deliveries of the same payment produce one order', async () => {
  const held = await holdSeats([seatIds[5]]);
  const q = await pricing.quoteReservation(held.data.reservation_id);

  const results = await Promise.all(
    Array.from({ length: 5 }, () => fulfill(held.data.reservation_id, q.breakdown)),
  );
  assert.ok(results.every((r) => r.data?.ok === true), 'none should error');

  const orderIds = new Set(results.map((r) => r.data.order_id));
  assert.equal(orderIds.size, 1, 'five simultaneous webhooks, one order');

  const { count } = await supabase.from('tickets')
    .select('id', { count: 'exact', head: true }).eq('order_id', [...orderIds][0]);
  assert.equal(count, 1, 'and one ticket, not five');
});

test('the ledger balances to zero on the card path', async () => {
  // BRD §08 — Stripe moves the organizer's share at the charge, so the transfer
  // is recorded immediately and nothing is left owed.
  const { data: balance } = await supabase.rpc('ledger_balance_cents', {
    p_event_id: ids.event, p_currency: 'CAD', p_channel: 'stripe',
  });
  assert.equal(Number(balance), 0, 'a card sale leaves no outstanding balance');
});

test('every order wrote its four ledger lines', async () => {
  const { data: entries } = await supabase
    .from('ledger_entries').select('entry_type, direction, amount_cents')
    .eq('event_id', ids.event);

  const types = new Set(entries.map((e) => e.entry_type));
  for (const t of ['sale', 'commission', 'commission_tax', 'payment_fee', 'transfer']) {
    assert.ok(types.has(t), `missing ${t} entries`);
  }
  // The sale is the only credit; everything else reduces it.
  assert.ok(entries.filter((e) => e.direction === 'credit').every((e) => e.entry_type === 'sale'));
});

test('a whole-table sale issues one ticket per seat', async () => {
  const { data: t } = await supabase.from('tables').insert({
    venue_map_id: ids.map, label: 'Second', seat_count: 5, price_cents: 22000,
  }).select('id').single();
  await supabase.from('seats').insert(
    Array.from({ length: 5 }, (_, i) => ({
      venue_map_id: ids.map, table_id: t.id, tier_id: ids.tier,
      section_key: 'Second', row_label: 'A', seat_number: String(i + 1),
    })),
  );

  const held = await holdTable(t.id);
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const res = await fulfill(held.data.reservation_id, q.breakdown);

  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  // Five people arrive at a table of five, and each needs something to scan.
  assert.equal(res.data.ticket_count, 5);

  const { data: tbl } = await supabase.from('tables').select('status').eq('id', t.id).single();
  assert.equal(tbl.status, 'sold');
});

test('a released hold is not fulfilled if the money arrives late', async () => {
  const held = await holdSeats([seatIds[6]]);
  const q = await pricing.quoteReservation(held.data.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });

  const res = await fulfill(held.data.reservation_id, q.breakdown);
  assert.equal(res.data.ok, false);
  assert.equal(res.data.error, 'RESERVATION_EXPIRED');

  // The seat must NOT have been quietly sold to a payment for a lapsed hold.
  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[6]).single();
  assert.equal(seat.status, 'available');
});

// ── Tickets ─────────────────────────────────────────────────────────────────

test('a ticket QR is a signed token, not an id', async () => {
  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const list = await ticketSvc.forOrder(order.id);

  assert.ok(list.length > 0);
  const t = list[0];
  assert.notEqual(t.qr, t.id, 'a raw id in a QR is a guessable bearer credential');
  assert.equal(t.qr.split('.').length, 3, 'should be a JWT');

  const resolved = await ticketSvc.forToken(t.qr);
  assert.equal(resolved.id, t.id);
  assert.equal(resolved.status, 'valid');
});

test('a forged or tampered QR resolves to nothing', async () => {
  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const [t] = await ticketSvc.forOrder(order.id);

  const tampered = `${t.qr.slice(0, -4)}AAAA`;
  assert.equal(await ticketSvc.forToken(tampered), null);
  assert.equal(await ticketSvc.forToken('nonsense'), null);
  assert.equal(ticketSvc.decodeQrToken('a.b.c'), null);
});

test('a session token cannot be used as a ticket QR', async () => {
  // Different secrets on purpose: a leaked QR secret must not also mint logins.
  const jwt = require('jsonwebtoken');
  const sessionish = jwt.sign({ typ: 'ticket', tid: 'x', eid: ids.event },
    process.env.JWT_SECRET, { algorithm: 'HS256' });
  assert.equal(ticketSvc.decodeQrToken(sessionish), null);
});

test('a valid ticket for another event does not resolve here', async () => {
  const jwt = require('jsonwebtoken');
  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const [t] = await ticketSvc.forOrder(order.id);

  // Correctly signed, but claims a different event than the ticket belongs to.
  const wrongEvent = jwt.sign(
    { typ: 'ticket', tid: t.id, eid: '00000000-0000-0000-0000-000000000000' },
    process.env.QR_JWT_SECRET, { algorithm: 'HS256' },
  );
  assert.equal(await ticketSvc.forToken(wrongEvent), null);
});

// ── Transfer (BRD §10) ──────────────────────────────────────────────────────

test('a stranger cannot transfer a guest ticket away from its buyer', async () => {
  // The check used to skip entirely when `orders.user_id` was null — which is
  // EVERY guest order, the primary path in this product. Anyone holding a
  // ticket id could take it, and a transfer is one-way and one-time, so the
  // real buyer lost it permanently.
  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const [t] = await ticketSvc.forOrder(order.id);

  await assert.rejects(
    () => ticketSvc.transfer({ ticketId: t.id, ownerUserId: null, toEmail: 'thief@eventsli-test.invalid' }),
    (e) => e.code === 'FORBIDDEN',
    'no proof at all must be refused',
  );

  await assert.rejects(
    () => ticketSvc.transfer({
      ticketId: t.id, ownerUserId: null,
      toEmail: 'thief@eventsli-test.invalid',
      proofEmail: 'someone-else@eventsli-test.invalid',
    }),
    (e) => e.code === 'FORBIDDEN',
    'the wrong address must be refused',
  );
});

test('the buyer transfers with the address they bought with, once', async () => {
  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const [t] = await ticketSvc.forOrder(order.id);

  const first = await ticketSvc.transfer({
    ticketId: t.id,
    ownerUserId: null,
    proofEmail: 'buyer@eventsli-test.invalid',   // the address on the order
    toEmail: 'friend@eventsli-test.invalid',
  });
  assert.equal(first.to, 'friend@eventsli-test.invalid');

  await assert.rejects(
    () => ticketSvc.transfer({
      ticketId: t.id, ownerUserId: null,
      proofEmail: 'buyer@eventsli-test.invalid',
      toEmail: 'third@eventsli-test.invalid',
    }),
    (e) => e.code === 'ALREADY_TRANSFERRED',
  );
});

test('transfers can be switched off per event', async () => {
  await supabase.from('events').update({ allow_ticket_transfer: false }).eq('id', ids.event);

  const { data: order } = await supabase.from('orders')
    .select('id').eq('event_id', ids.event).limit(1).single();
  const list = await ticketSvc.forOrder(order.id);
  const fresh = list.find((x) => !x.transferred);

  if (fresh) {
    await assert.rejects(
      () => ticketSvc.transfer({
        ticketId: fresh.id, ownerUserId: null,
        proofEmail: 'buyer@eventsli-test.invalid',
        toEmail: 'x@eventsli-test.invalid',
      }),
      // Checked BEFORE ownership: the organizer's switch applies to everyone,
      // including the rightful owner.
      (e) => e.code === 'TRANSFER_DISABLED',
    );
  }
  await supabase.from('events').update({ allow_ticket_transfer: true }).eq('id', ids.event);
});
