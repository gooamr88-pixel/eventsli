const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

/**
 * THE WEBHOOK ITSELF, OVER HTTP (2026-10-15).
 *
 * fulfillment.test.js drives `fulfill_checkout` directly. Nothing exercised the
 * endpoint Stripe actually calls: the signature check, the claim row that makes
 * a redelivery a no-op, the expired-session release, and what a refund does.
 *
 * NO NETWORK, NO CARD. Verifying a signature is an HMAC over the raw body, done
 * locally by the SDK; nothing on this path calls Stripe's API. The key below is
 * a placeholder the SDK only needs to construct a client — it is never sent
 * anywhere — and the signing secret is a local one, so a payload signed here is
 * worthless to any real endpoint.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_placeholder_never_sent';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline_local_test_secret';

const Stripe = require('stripe');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

const signer = Stripe(process.env.STRIPE_SECRET_KEY);
let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let seatIds = [];
let n = 0;
const eventId = () => `evt_local_${stamp}_${(n += 1)}`;

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `whk-${stamp}@eventsli-test.invalid`, full_name: 'Webhook Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Webhook Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `whk-test-${stamp}`, title: 'Webhook Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
    commission_pct: 1.5, commission_tax_pct: 13, event_tax_pct: 13,
    payment_fee_mode: 'auto', fee_bearer: 'buyer',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;
  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'Standard', price_cents: 5000 }).select('id').single();
  const { data: t } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'Main', seat_count: 6, price_cents: 30000,
  }).select('id').single();
  const { data: s } = await supabase.from('seats').insert(Array.from({ length: 6 }, (_, i) => ({
    venue_map_id: map.id, table_id: t.id, tier_id: tier.id,
    section_key: 'Main', row_label: 'A', seat_number: String(i + 1),
  }))).select('id');
  seatIds = s.map((r) => r.id);
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  await supabase.from('webhook_events').delete().like('stripe_event_id', `evt_local_${stamp}_%`);
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
  if (ids.profile) await supabase.from('profiles').delete().eq('id', ids.profile);
  await new Promise((r) => server.close(r));
});

const hold = async (seats) => {
  const { data } = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: seats, p_ttl_minutes: 35,
  });
  assert.equal(data?.ok, true, JSON.stringify(data));
  return data.reservation_id;
};

const stripeEvent = (type, object, id = eventId()) => ({
  id, object: 'event', type, api_version: '2024-06-20', created: Math.floor(Date.now() / 1000),
  data: { object },
});
const session = (reservationId, over = {}) => ({
  id: `cs_test_local_${stamp}_${(n += 1)}`, object: 'checkout.session',
  payment_status: 'paid', payment_intent: `pi_test_local_${stamp}_${n}`,
  metadata: { reservation_id: reservationId },
  customer_details: { name: 'Webhook Buyer', email: 'buyer@eventsli-test.invalid' },
  ...over,
});

/** Posts the exact bytes that were signed, as Stripe does. */
async function deliver(evt, { secret = process.env.STRIPE_WEBHOOK_SECRET, sign = true, body } = {}) {
  const payload = JSON.stringify(evt);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['stripe-signature'] = signer.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${baseUrl}/payments/webhook`, { method: 'POST', headers, body: body ?? payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const claimRow = async (id) => (await supabase.from('webhook_events')
  .select('processed_at, error').eq('stripe_event_id', id).maybeSingle()).data;

// ── Nothing unsigned gets in ────────────────────────────────────────────────

test('an unsigned post is refused, and records nothing', async () => {
  const evt = stripeEvent('checkout.session.completed', session('00000000-0000-0000-0000-000000000000'));
  const res = await deliver(evt, { sign: false });
  assert.equal(res.status, 400);
  assert.equal(await claimRow(evt.id), null);
});

test('a post signed with any other secret is refused', async () => {
  const evt = stripeEvent('checkout.session.completed', session('00000000-0000-0000-0000-000000000000'));
  const res = await deliver(evt, { secret: 'whsec_someone_elses_secret' });
  assert.equal(res.status, 400);
});

test('a body changed after signing is refused — a forged "paid" cannot mint tickets', async () => {
  const reservationId = await hold([seatIds[0]]);
  const unpaid = stripeEvent('checkout.session.completed', session(reservationId, { payment_status: 'unpaid' }));
  const forged = JSON.stringify({ ...unpaid, data: { object: { ...unpaid.data.object, payment_status: 'paid' } } });
  const res = await deliver(unpaid, { body: forged });
  assert.equal(res.status, 400);
  const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId);
  assert.equal(count, 0);
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

// ── A paid checkout ─────────────────────────────────────────────────────────

test('a paid checkout issues the order and its tickets, once, however often it is delivered', async () => {
  const reservationId = await hold([seatIds[1], seatIds[2]]);
  const cs = session(reservationId);
  const evt = stripeEvent('checkout.session.completed', cs);

  const first = await deliver(evt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.orderId);

  const { data: order } = await supabase.from('orders').select('id, status').eq('id', first.body.orderId).single();
  assert.equal(order.status, 'paid');
  const { count: tickets } = await supabase.from('tickets').select('id', { count: 'exact', head: true })
    .eq('order_id', order.id);
  assert.equal(tickets, 2);
  const { data: seats } = await supabase.from('seats').select('status').in('id', [seatIds[1], seatIds[2]]);
  assert.ok(seats.every((s) => s.status === 'sold'));
  const row = await claimRow(evt.id);
  assert.ok(row.processed_at);
  assert.equal(row.error, null);

  // The same delivery again: acknowledged as a duplicate.
  const again = await deliver(evt);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);

  // A DIFFERENT event for the same session (async_payment_succeeded follows
  // completed for some payment methods): the same order comes back.
  const sibling = await deliver(stripeEvent('checkout.session.async_payment_succeeded', cs));
  assert.equal(sibling.status, 200);
  assert.equal(sibling.body.orderId, order.id);

  const { count: orders } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId);
  assert.equal(orders, 1, 'three deliveries, one order');
});

test('a completed session that is not paid issues nothing', async () => {
  const reservationId = await hold([seatIds[3]]);
  const res = await deliver(stripeEvent('checkout.session.completed', session(reservationId, { payment_status: 'unpaid' })));
  assert.equal(res.status, 200);
  assert.equal(res.body.skipped, 'not paid');
  const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId);
  assert.equal(count, 0);
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

// ── An abandoned checkout ───────────────────────────────────────────────────

test('an expired session puts the seats back at once', async () => {
  const reservationId = await hold([seatIds[4]]);
  const res = await deliver(stripeEvent('checkout.session.expired', session(reservationId, { payment_status: 'unpaid' })));
  assert.equal(res.status, 200);
  const { data: r } = await supabase.from('reservations').select('state').eq('id', reservationId).single();
  assert.notEqual(r.state, 'active');
  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[4]).single();
  assert.equal(seat.status, 'available');
});

test('a payment that lands after its hold was released issues no tickets, and is not retried forever', async () => {
  const reservationId = await hold([seatIds[5]]);
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
  const evt = stripeEvent('checkout.session.completed', session(reservationId));
  const res = await deliver(evt);
  // 200 — retrying can never change the answer; the row holds it for review.
  assert.equal(res.status, 200);
  assert.ok(res.body.error);
  assert.ok((await claimRow(evt.id)).error, 'recorded on the row an operator works from');
  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[5]).single();
  assert.equal(seat.status, 'available');
});

// ── Refunds ─────────────────────────────────────────────────────────────────

test('a refund is recorded for review and does NOT reverse the order (refunds are not automated)', async () => {
  const { data: order } = await supabase.from('orders').select('id, status, stripe_payment_intent_id')
    .eq('event_id', ids.event).eq('status', 'paid').limit(1).single();
  const evt = stripeEvent('charge.refunded', {
    id: `ch_test_local_${stamp}`, object: 'charge', refunded: true, amount_refunded: 1000,
    payment_intent: order.stripe_payment_intent_id,
  });
  const res = await deliver(evt);
  assert.equal(res.status, 200);
  assert.equal(res.body.review, true);
  const { data: after } = await supabase.from('orders').select('status').eq('id', order.id).single();
  assert.equal(after.status, 'paid', 'the order and its tickets stand until a person acts');
  assert.ok((await claimRow(evt.id)).processed_at);
});

test('an event type the platform does not use is acknowledged so Stripe stops sending it', async () => {
  const res = await deliver(stripeEvent('customer.created', { id: 'cus_test_local', object: 'customer' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, 'customer.created');
});
