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
// The organizer's own (test-only) connected account, and a stranger's.
const ORG_ACCOUNT = `acct_test_whk_org_${stamp}`;
const OTHER_ACCOUNT = `acct_test_whk_other_${stamp}`;
const eventId = () => `evt_local_${stamp}_${(n += 1)}`;

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `whk-${stamp}@eventsli-test.invalid`, full_name: 'Webhook Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Webhook Co', country: 'CA',
    stripe_account_id: ORG_ACCOUNT,
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
    venue_map_id: map.id, label: 'Main', seat_count: 16, price_cents: 30000,
  }).select('id').single();
  const { data: s } = await supabase.from('seats').insert(Array.from({ length: 16 }, (_, i) => ({
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

/**
 * DIRECT CHARGES (T-074). Checkout records, on the hold, the session it made
 * and the organizer account it lives on; Stripe stamps `event.account` on every
 * event from that account. A paid session counts only when all three agree.
 */
async function bind(reservationId, cs, account = ORG_ACCOUNT) {
  const { error } = await supabase.from('reservations')
    .update({ attendee_data: { buyer: { email: 'buyer@eventsli-test.invalid' }, stripeSessionId: cs.id, stripeAccountId: account } })
    .eq('id', reservationId);
  assert.equal(error, null);
  return cs;
}
const fromAccount = (evt, account = ORG_ACCOUNT) => ({ ...evt, account });

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
  const cs = await bind(reservationId, session(reservationId));
  const evt = fromAccount(stripeEvent('checkout.session.completed', cs));

  const first = await deliver(evt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.orderId);

  const { data: order } = await supabase.from('orders')
    .select('id, status, charge_model, stripe_account_id').eq('id', first.body.orderId).single();
  assert.equal(order.status, 'paid');
  assert.equal(order.charge_model, 'direct');
  assert.equal(order.stripe_account_id, ORG_ACCOUNT);
  // The money was always the organizer's: no transfer row, no platform-kept
  // payment fee. Only the sale and Eventsli's fee are written.
  const { data: kinds } = await supabase.from('ledger_entries').select('entry_type').eq('order_id', order.id);
  const types = kinds.map((k) => k.entry_type).sort();
  assert.ok(types.includes('sale'));
  assert.ok(!types.includes('transfer'), `no transfer under direct charges: ${types}`);
  assert.ok(!types.includes('payment_fee'), `no platform payment fee under direct charges: ${types}`);
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
  const sibling = await deliver(fromAccount(stripeEvent('checkout.session.async_payment_succeeded', cs)));
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
  const cs = await bind(reservationId, session(reservationId, { payment_status: 'unpaid' }));
  const res = await deliver(fromAccount(stripeEvent('checkout.session.expired', cs)));
  assert.equal(res.status, 200);
  const { data: r } = await supabase.from('reservations').select('state').eq('id', reservationId).single();
  assert.notEqual(r.state, 'active');
  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[4]).single();
  assert.equal(seat.status, 'available');
});

test('a payment that lands after its hold was released issues no tickets, and is not retried forever', async () => {
  const reservationId = await hold([seatIds[5]]);
  const cs = await bind(reservationId, session(reservationId));
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
  const evt = fromAccount(stripeEvent('checkout.session.completed', cs));
  const res = await deliver(evt);
  // 200 — retrying can never change the answer; the row holds it for review.
  assert.equal(res.status, 200);
  assert.ok(res.body.error);
  assert.ok((await claimRow(evt.id)).error, 'recorded on the row an operator works from');
  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[5]).single();
  assert.equal(seat.status, 'available');
});

// ── Refunds ─────────────────────────────────────────────────────────────────

// ── Organizer isolation (T-074) ─────────────────────────────────────────────

test('REGRESSION: a signed, paid session we never created for that hold issues nothing', async () => {
  // Any organizer can create a Checkout Session on their OWN account with any
  // metadata. Pointing it at someone else's hold must not mint tickets.
  const reservationId = await hold([seatIds[6]]);
  await bind(reservationId, session(reservationId));                // ours
  const forged = session(reservationId);                            // not ours
  const evt = fromAccount(stripeEvent('checkout.session.completed', forged));
  const res = await deliver(evt);
  assert.equal(res.status, 200, 'permanent: retrying cannot change it');
  assert.equal(res.body.error, 'FORBIDDEN');
  const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId);
  assert.equal(count, 0);
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

test('REGRESSION: our session, but reported from another organizer\'s account, issues nothing', async () => {
  const reservationId = await hold([seatIds[7]]);
  const cs = await bind(reservationId, session(reservationId));
  const res = await deliver(fromAccount(stripeEvent('checkout.session.completed', cs), OTHER_ACCOUNT));
  assert.equal(res.body.error, 'FORBIDDEN');
  const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId);
  assert.equal(count, 0);
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

test('REGRESSION: the database refuses a direct charge on an account that is not the organizer\'s', async () => {
  // Defence in depth below the controller: fulfill_checkout re-checks.
  const reservationId = await hold([seatIds[8]]);
  const pricing = require('../../services/pricingService');
  const q = await pricing.quoteReservation(reservationId);
  const { data } = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: reservationId, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { name: 'X', email: 'buyer@eventsli-test.invalid' },
    p_stripe: { session_id: `cs_test_db_${stamp}`, account_id: OTHER_ACCOUNT },
  });
  assert.equal(data.ok, false);
  assert.equal(data.error, 'FORBIDDEN');
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

test('REGRESSION: an expired session that is not the hold\'s own leaves the seats held', async () => {
  const reservationId = await hold([seatIds[9]]);
  await bind(reservationId, session(reservationId));
  const stranger = session(reservationId, { payment_status: 'unpaid' });
  await deliver(fromAccount(stripeEvent('checkout.session.expired', stranger), OTHER_ACCOUNT));
  const { data: r } = await supabase.from('reservations').select('state').eq('id', reservationId).single();
  assert.equal(r.state, 'active', 'a stranger cannot put someone else\'s seats back on sale');
  await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
});

// ── After the sale: refunds and disputes on the organizer's account ─────────

async function paidOrder(seat) {
  const reservationId = await hold([seat]);
  const cs = await bind(reservationId, session(reservationId));
  const res = await deliver(fromAccount(stripeEvent('checkout.session.completed', cs)));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { data } = await supabase.from('orders')
    .select('id, buyer_total_cents, stripe_payment_intent_id, refunded_cents, dispute_status')
    .eq('id', res.body.orderId).single();
  return data;
}
const ledgerOf = async (orderId) => (await supabase.from('ledger_entries')
  .select('entry_type, direction, amount_cents').eq('order_id', orderId)).data;
const ticketsOf = async (orderId) => (await supabase.from('tickets').select('status').eq('order_id', orderId)).data;
const charge = (order, over = {}) => ({
  id: `ch_test_local_${stamp}_${(n += 1)}`, object: 'charge', payment_intent: order.stripe_payment_intent_id, ...over,
});

test('a partial refund on the organizer\'s account is recorded once; tickets stand', async () => {
  const order = await paidOrder(seatIds[10]);
  const evt = fromAccount(stripeEvent('charge.refunded', charge(order, { refunded: false, amount_refunded: 1000 })));
  const res = await deliver(evt);
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'recorded');
  const again = await deliver(fromAccount(stripeEvent('charge.refunded', charge(order, { amount_refunded: 1000 }))));
  assert.equal(again.status, 200, 'a second event at the same cumulative amount writes nothing');

  const { data: after } = await supabase.from('orders').select('status, refunded_cents').eq('id', order.id).single();
  assert.equal(after.refunded_cents, 1000);
  assert.equal(after.status, 'paid');
  const refunds = (await ledgerOf(order.id)).filter((l) => l.entry_type === 'refund');
  assert.deepEqual(refunds.map((r) => [r.direction, Number(r.amount_cents)]), [['debit', 1000]]);
  assert.ok((await ticketsOf(order.id)).every((t) => t.status === 'valid'));
});

test('a full refund voids the tickets; the ledger reconciles to the cumulative refund', async () => {
  const order = await paidOrder(seatIds[11]);
  await deliver(fromAccount(stripeEvent('charge.refunded', charge(order, { amount_refunded: 500 }))));
  await deliver(fromAccount(stripeEvent('charge.refunded', charge(order, { refunded: true, amount_refunded: order.buyer_total_cents }))));
  const refunds = (await ledgerOf(order.id)).filter((l) => l.entry_type === 'refund');
  const total = refunds.reduce((s, r) => s + Number(r.amount_cents), 0);
  assert.equal(total, order.buyer_total_cents, 'the refund rows add up to what Stripe refunded');
  assert.ok((await ticketsOf(order.id)).every((t) => t.status === 'void'), 'a fully refunded ticket does not admit');
});

test('a refund event from another organizer\'s account changes nothing', async () => {
  const order = await paidOrder(seatIds[12]);
  const res = await deliver(fromAccount(stripeEvent('charge.refunded', charge(order, { amount_refunded: order.buyer_total_cents })), OTHER_ACCOUNT));
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'FORBIDDEN');
  const { data: after } = await supabase.from('orders').select('refunded_cents').eq('id', order.id).single();
  assert.equal(after.refunded_cents, 0);
});

test('a dispute: funds withdrawn and reinstated are each recorded once; a lost dispute voids tickets', async () => {
  const order = await paidOrder(seatIds[13]);
  const dispute = (status, over = {}) => ({
    id: `dp_test_local_${stamp}_${order.id.slice(0, 6)}`, object: 'dispute', status,
    amount: order.buyer_total_cents, charge: `ch_test_local_${stamp}_dp`, payment_intent: order.stripe_payment_intent_id, ...over,
  });
  await deliver(fromAccount(stripeEvent('charge.dispute.created', dispute('needs_response'))));
  await deliver(fromAccount(stripeEvent('charge.dispute.funds_withdrawn', dispute('needs_response'))));
  await deliver(fromAccount(stripeEvent('charge.dispute.funds_withdrawn', dispute('needs_response')))); // redelivery, new event id
  let { data: o } = await supabase.from('orders').select('dispute_status, disputed_cents').eq('id', order.id).single();
  assert.equal(o.dispute_status, 'needs_response');
  let adj = (await ledgerOf(order.id)).filter((l) => l.entry_type === 'adjustment');
  assert.deepEqual(adj.map((a) => a.direction), ['debit'], 'withdrawn once, however often it is reported');

  await deliver(fromAccount(stripeEvent('charge.dispute.closed', dispute('lost'))));
  ({ data: o } = await supabase.from('orders').select('dispute_status').eq('id', order.id).single());
  assert.equal(o.dispute_status, 'lost');
  assert.ok((await ticketsOf(order.id)).every((t) => t.status === 'void'), 'a charged-back ticket does not admit');
  adj = (await ledgerOf(order.id)).filter((l) => l.entry_type === 'adjustment');
  assert.equal(adj.length, 1);
});

// ── Stripe does not order events ────────────────────────────────────────────

test('REGRESSION: a dispute that arrives BEFORE its payment\'s checkout event is not lost', async () => {
  // Seen with real delivery (2026-11-06): charge.dispute.created and
  // funds_withdrawn landed one second ahead of checkout.session.completed, were
  // answered "no such order" and acknowledged — a chargeback the ledger never
  // saw. The webhook now fulfils the payment first, through the same checks.
  const stripeSvc = require('../../services/stripeService');
  const original = stripeSvc.sessionForPaymentIntent;
  const reservationId = await hold([seatIds[14]]);
  const cs = await bind(reservationId, session(reservationId));
  // Stripe's answer to "which session made this PaymentIntent?" — the one we bound.
  stripeSvc.sessionForPaymentIntent = async (pi, account) => (pi === cs.payment_intent && account === ORG_ACCOUNT ? cs : null);
  try {
    const dispute = {
      id: `dp_test_early_${stamp}`, object: 'dispute', status: 'needs_response', amount: 5000,
      charge: `ch_test_early_${stamp}`, payment_intent: cs.payment_intent,
    };
    const res = await deliver(fromAccount(stripeEvent('charge.dispute.funds_withdrawn', dispute)));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, 'recorded');

    const { data: order } = await supabase.from('orders')
      .select('id, status, dispute_status, charge_model').eq('reservation_id', reservationId).single();
    assert.equal(order.status, 'paid', 'the payment was fulfilled first');
    assert.equal(order.charge_model, 'direct');
    assert.equal(order.dispute_status, 'needs_response');
    const adj = (await ledgerOf(order.id)).filter((l) => l.entry_type === 'adjustment');
    assert.deepEqual(adj.map((a) => a.direction), ['debit'], 'the withdrawal is recorded once');

    // The payment's own event arriving afterwards changes nothing.
    const late = await deliver(fromAccount(stripeEvent('checkout.session.completed', cs)));
    assert.equal(late.status, 200);
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('reservation_id', reservationId);
    assert.equal(count, 1);
  } finally {
    stripeSvc.sessionForPaymentIntent = original;
  }
});

test('an early dispute for a charge Eventsli never created is still ignored', async () => {
  const stripeSvc = require('../../services/stripeService');
  const original = stripeSvc.sessionForPaymentIntent;
  stripeSvc.sessionForPaymentIntent = async () => null;   // no session of ours
  try {
    const res = await deliver(fromAccount(stripeEvent('charge.dispute.created', {
      id: `dp_test_foreign_${stamp}`, object: 'dispute', status: 'needs_response', amount: 1000,
      charge: `ch_test_foreign_${stamp}`, payment_intent: `pi_test_foreign_${stamp}`,
    })));
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'ORDER_NOT_FOUND');
  } finally {
    stripeSvc.sessionForPaymentIntent = original;
  }
});

test('an event type the platform does not use is acknowledged so Stripe stops sending it', async () => {
  const res = await deliver(stripeEvent('customer.created', { id: 'cus_test_local', object: 'customer' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, 'customer.created');
});
