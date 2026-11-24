const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const venue = require('../../services/venueService');
const app = require('../../app');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PAYING THE ORGANIZER OFFLINE — THE FIVE ASSURANCES (owner, 2026-11-24),
 * proved end to end against the real database, with RESERVED SEATS:
 *
 *   1. Proof of payment: the buyer uploads the transfer receipt; the organizer
 *      sees it, privately; it is on the payment log.
 *   2. Inventory protection: a reserved seat cannot be held or sold to anyone
 *      else while the reservation stands.
 *   3. Automatic expiration: an unpaid reservation past its deadline expires on
 *      the sweep, and its seats go back on sale.
 *   4. The payment log says WHO confirmed the payment and WHEN.
 *   5. One seat, one ticket: the database refuses a second live ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = {};
const cleanup = { profiles: [], organizers: [], events: [] };
let settingBefore;

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
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const setOffline = (value) => supabase.from('platform_settings').upsert({ key: 'offline_checkout', value }, { onConflict: 'key' });
const SIG = { method: 'typed', name: 'Mona Buyer' };

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const { data: s } = await supabase.from('platform_settings').select('value').eq('key', 'offline_checkout').maybeSingle();
  settingBefore = s?.value || null;
  await setOffline({ enabled: true, payment_hours: 48, min_hours_before_event: 2 });

  ids.org = client();
  const email = `assure-org-${stamp}@eventsli-test.invalid`;
  const reg = await ids.org('POST', '/auth/register', { email, password: PASSWORD, fullName: 'Nour Organizer' });
  ids.orgUser = reg.body.data.id;
  cleanup.profiles.push(ids.orgUser);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', ids.orgUser);
  await ids.org('POST', '/auth/login', { email, password: PASSWORD });
  const org = await ids.org('POST', '/organizer', {
    displayName: 'Seat Assurance Co', legalName: 'Seat Assurance LLC', acceptPolicies: true, country: 'EG',
    description: 'Runs the events the offline assurance suite creates and deletes.',
  });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  ids.organizerId = org.body.data.id;
  cleanup.organizers.push(ids.organizerId);
  const method = await ids.org('POST', '/organizer/payment-methods', {
    kind: 'mobile_money', label: 'Vodafone Cash', instructions: 'Send to 010 0000 0000 with the reference.',
  });
  ids.methodId = method.body.data.id;

  const ev = await ids.org('POST', '/events', {
    title: `Seat Assurance ${stamp}`, country: 'EG', timezone: 'Africa/Cairo', admissionType: 'reserved',
    startsAt: new Date(Date.now() + 20 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 20 * 86400e3 + 3 * 3600e3).toISOString(),
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  ids.eventId = ev.body.data.id;
  ids.slug = ev.body.data.slug;
  cleanup.events.push(ids.eventId);
  const tier = await ids.org('POST', `/events/${ids.eventId}/tiers`, { name: 'Standard', priceCents: 50000, quantity: 10 });
  ids.tierId = tier.body.data.id;
  await venue.saveMap(ids.eventId, {
    layout: {},
    tables: [{ label: 'T1', seatCount: 8, priceCents: null, tierId: ids.tierId, isPrivate: false, shape: 'round', position: { x: 50, y: 50, rotation: 0 } }],
  });
  const map = await venue.getMapForOrganizer(ids.eventId);
  ids.seats = map.tables[0].seats.map((s) => s.id);
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { error } = await supabase.from('events').update({
    status: 'published', accepts_stripe: false, accepts_manual: true, terms_accepted_id: terms.id,
    holder_details: 'off', purchase_mode: 'seat_only',
  }).eq('id', ids.eventId);
  assert.ifError(error);
});

after(async () => {
  if (settingBefore) await setOffline(settingBefore);
  for (const id of cleanup.events) {
    const { data: pays } = await supabase.from('offline_payments').select('id, proof_path').eq('event_id', id);
    const files = (pays || []).map((p) => p.proof_path).filter(Boolean);
    if (files.length) await supabase.storage.from('payment-proofs').remove(files);
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    const orderIds = (orders || []).map((o) => o.id);
    await supabase.from('offline_payments').delete().eq('event_id', id);
    if (orderIds.length) {
      await supabase.from('tickets').delete().in('order_id', orderIds);
      await supabase.from('ledger_entries').delete().in('order_id', orderIds);
      await supabase.from('order_items').delete().in('order_id', orderIds);
      await supabase.from('orders').delete().in('id', orderIds);
    }
    await supabase.from('reservations').delete().eq('event_id', id);
    const { data: m } = await supabase.from('venue_maps').select('id').eq('event_id', id).maybeSingle();
    if (m) {
      await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('tables').delete().eq('venue_map_id', m.id);
      await supabase.from('venue_maps').delete().eq('id', m.id);
    }
    await supabase.from('events').delete().eq('id', id);
  }
  for (const id of cleanup.organizers) {
    await supabase.from('organizer_payment_methods').delete().eq('organizer_id', id);
    await supabase.from('organizers').delete().eq('id', id);
  }
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

/** A buyer holds these seats and reserves them to pay offline. */
async function reserveSeats(seatIds) {
  const buyer = client();
  const hold = await buyer('POST', `/public/events/${ids.slug}/hold`, { seatIds });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const res = await buyer('POST', `/public/reservations/${hold.body.data.reservationId}/offline`, {
    methodId: ids.methodId, name: 'Mona Buyer', email: `buyer-${randomUUID().slice(0, 8)}@eventsli-test.invalid`,
    acceptTerms: true, signature: SIG,
  }, { 'x-access-token': hold.body.data.reservationToken });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { buyer, reservationId: hold.body.data.reservationId, offlineId: res.body.data.id, token: res.body.data.accessToken, holdToken: hold.body.data.reservationToken };
}
const actions = async (offlineId) => (await supabase.from('payment_audit').select('action, actor_id, actor_role, created_at')
  .eq('offline_payment_id', offlineId).order('created_at')).data;

// ── 2. Inventory protection ────────────────────────────────────────────────
test('2. a seat reserved to pay offline cannot be held by anyone else', async () => {
  ids.a = await reserveSeats([ids.seats[0], ids.seats[1]]);
  const { data: seats } = await supabase.from('seats').select('id, status, held_by_reservation').in('id', [ids.seats[0], ids.seats[1]]);
  assert.ok(seats.every((s) => s.status === 'held' && s.held_by_reservation === ids.a.reservationId), 'held by this reservation');
  const { data: res } = await supabase.from('reservations').select('expires_at').eq('id', ids.a.reservationId).single();
  assert.ok(new Date(res.expires_at) > new Date(Date.now() + 40 * 3600e3), 'held until the payment deadline, not the usual 35 minutes');

  const other = await client()('POST', `/public/events/${ids.slug}/hold`, { seatIds: [ids.seats[0]] });
  assert.ok(other.status >= 400 && other.status < 500, `refused, got ${other.status}`);
  assert.notEqual(other.body?.success, true);
});

// ── 1. Proof of payment ────────────────────────────────────────────────────
test('1. the receipt: only photos or PDFs, only with the buyer\'s link; recorded, logged and shown to the organizer', async () => {
  const q = `?token=${encodeURIComponent(ids.a.token)}`;
  const bad = await ids.a.buyer('POST', `/public/offline-payments/${ids.a.offlineId}/proof/sign${q}`, { contentType: 'text/html' });
  assert.equal(bad.status, 415, 'only photos and PDFs');
  const stranger = await client()('POST', `/public/offline-payments/${ids.a.offlineId}/proof/sign`, { contentType: 'image/png' });
  assert.equal(stranger.status, 404, 'no token, no upload');
  const outside = await ids.a.buyer('POST', `/public/offline-payments/${ids.a.offlineId}/proof${q}`, { path: `offline/${randomUUID()}/proof-x.png` });
  assert.equal(outside.status, 400, 'a file outside this reservation is refused');

  // The storage upload itself is covered by test/offlineProof.test.js (this
  // machine runs no storage service); here, the database's part of it.
  const path = `offline/${ids.a.offlineId}/proof-test.png`;
  const { data: rec, error } = await supabase.rpc('offline_attach_proof', { p_offline_id: ids.a.offlineId, p_path: path, p_content_type: 'image/png' });
  assert.ifError(error);
  assert.equal(rec.ok, true);

  const view = await ids.a.buyer('GET', `/public/offline-payments/${ids.a.offlineId}${q}`);
  assert.ok(view.body.data.proof?.uploadedAt, 'the buyer sees it was sent');
  const list = await ids.org('GET', `/events/${ids.eventId}/offline-payments`);
  const row = list.body.data.payments.find((p) => p.id === ids.a.offlineId);
  assert.equal(row.proof.contentType, 'image/png', 'the organizer sees the receipt beside the reservation');
  assert.ok((await actions(ids.a.offlineId)).some((a) => a.action === 'offline.proof_uploaded' && a.actor_role === 'buyer'));
});

// ── "I've sent the payment" (2026-11-24) ───────────────────────────────────
test('the buyer\'s last step: "I\'ve sent the payment" is recorded once, logged, shown to the organizer — and issues nothing', async () => {
  const q = `?token=${encodeURIComponent(ids.a.token)}`;
  const stranger = await client()('POST', `/public/offline-payments/${ids.a.offlineId}/sent`);
  assert.equal(stranger.status, 404, 'no token, nothing recorded');

  const sent = await ids.a.buyer('POST', `/public/offline-payments/${ids.a.offlineId}/sent${q}`);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(sent.body.data.sentAt, 'the buyer\'s page knows');
  assert.equal(sent.body.data.status, 'awaiting', 'still waiting for the organizer — no tickets yet');

  const again = await ids.a.buyer('POST', `/public/offline-payments/${ids.a.offlineId}/sent${q}`);
  assert.equal(again.body.data.sentAt, sent.body.data.sentAt, 'pressing again changes nothing');
  assert.equal((await actions(ids.a.offlineId)).filter((a) => a.action === 'offline.buyer_sent').length, 1, 'logged once');

  const list = await ids.org('GET', `/events/${ids.eventId}/offline-payments`);
  assert.ok(list.body.data.payments.find((p) => p.id === ids.a.offlineId).buyerSentAt, 'the organizer sees it');
  const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('event_id', ids.eventId);
  assert.equal(count, 0);
});

// ── Back at the checkout after choosing to pay offline (2026-11-24) ────────
test('a hold being paid offline: the checkout links to its payment page, and a card payment is refused with the reason', async () => {
  const c = await reserveSeats([ids.seats[6]]);
  const h = { 'x-access-token': c.holdToken };
  const q = await c.buyer('GET', `/public/reservations/${c.reservationId}/quote`, undefined, h);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.ok(q.body.data.offlinePending, 'the page is told');
  assert.ok(q.body.data.offlinePending.url.startsWith(`/checkout/offline/${c.offlineId}?token=`), q.body.data.offlinePending.url);
  const stranger = await client()('GET', `/public/reservations/${c.reservationId}/quote`);
  assert.equal(stranger.body?.data?.offlinePending ?? null, null, 'never to someone without the hold');
  const card = await c.buyer('POST', `/public/reservations/${c.reservationId}/checkout`, { email: 'x@eventsli-test.invalid', name: 'X Y', acceptTerms: true, signature: SIG }, h);
  assert.ok([409, 503].includes(card.status), `refused, got ${card.status}`);
  if (card.status === 409) assert.match(card.body.message, /pay the organizer/);
});

// ── 4. Who confirmed, and when ─────────────────────────────────────────────
test('4. confirming is logged with the person who did it and the time', async () => {
  const before = Date.now();
  const paid = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.a.offlineId}/confirm`,
    { amountCents: 100000, confirmKey: randomUUID() });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));

  const log = await actions(ids.a.offlineId);
  const confirmed = log.find((a) => a.action === 'offline.confirmed');
  assert.equal(confirmed.actor_id, ids.orgUser, 'who');
  assert.equal(confirmed.actor_role, 'organizer');
  assert.ok(Date.parse(confirmed.created_at) >= before - 5000, 'when');

  const list = await ids.org('GET', `/events/${ids.eventId}/offline-payments`);
  const row = list.body.data.payments.find((p) => p.id === ids.a.offlineId);
  assert.equal(row.status, 'paid');
  assert.equal(row.confirmedBy.name, 'Nour Organizer');
  assert.ok(row.confirmedAt);
  const trail = await ids.org('GET', `/events/${ids.eventId}/payment-audit`);
  const entry = trail.body.data.find((a) => a.offlinePaymentId === ids.a.offlineId && a.action === 'offline.confirmed');
  assert.equal(entry.actor.name, 'Nour Organizer', 'the log names the person');

  // Paid: the receipt can no longer be swapped.
  const late = await ids.a.buyer('POST', `/public/offline-payments/${ids.a.offlineId}/proof/sign?token=${encodeURIComponent(ids.a.token)}`, { contentType: 'image/png' });
  assert.equal(late.status, 409);
  const { data: refused } = await supabase.rpc('offline_attach_proof', { p_offline_id: ids.a.offlineId, p_path: 'x', p_content_type: 'image/png' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'CONFLICT');
});

// ── 5. One seat, one ticket ────────────────────────────────────────────────
test('5. a sold seat cannot be held again, and the database refuses a second live ticket for it', async () => {
  const { data: tickets } = await supabase.from('tickets').select('id, order_id, seat_id, status').eq('seat_id', ids.seats[0]);
  assert.equal(tickets.length, 1, 'exactly one ticket was issued for the seat');
  assert.equal(tickets[0].status, 'valid');

  const again = await client()('POST', `/public/events/${ids.slug}/hold`, { seatIds: [ids.seats[0]] });
  assert.ok(again.status >= 400 && again.status < 500, `a sold seat cannot be held, got ${again.status}`);

  const { error } = await supabase.from('tickets').insert({
    order_id: tickets[0].order_id, event_id: ids.eventId, seat_id: ids.seats[0], tier_id: ids.tierId, status: 'valid',
  });
  assert.ok(error, 'a second live ticket for the same seat is refused');
  assert.equal(error.code, '23505');
  assert.match(error.message, /tickets_one_live_per_seat/);
});

// ── 3. Automatic expiration ────────────────────────────────────────────────
test('3. an unpaid reservation past its deadline expires on the sweep and its seats go back on sale', async () => {
  const c = await reserveSeats([ids.seats[2]]);
  const past = new Date(Date.now() - 60_000).toISOString();
  await supabase.from('reservations').update({ expires_at: past }).eq('id', c.reservationId);
  await supabase.from('offline_payments').update({ due_at: past }).eq('id', c.offlineId);

  const { data: released, error } = await supabase.rpc('expire_stale_reservations');
  assert.ifError(error);
  assert.ok(released >= 1);

  const { data: pay } = await supabase.from('offline_payments').select('status, close_reason').eq('id', c.offlineId).single();
  assert.equal(pay.status, 'expired');
  const { data: seat } = await supabase.from('seats').select('status, held_by_reservation').eq('id', ids.seats[2]).single();
  assert.equal(seat.status, 'available');
  assert.equal(seat.held_by_reservation, null);
  assert.ok((await actions(c.offlineId)).some((a) => a.action === 'offline.expired' && a.actor_role === 'system'));

  const next = await client()('POST', `/public/events/${ids.slug}/hold`, { seatIds: [ids.seats[2]] });
  assert.equal(next.status, 201, 'someone else can now buy it');
});

// ── Commission as a percentage plus a fixed amount (2026-11-24) ─────────────
test('the fixed commission is charged per paid ticket, and shown to the organizer before creating an event', async () => {
  const { data: before } = await supabase.from('platform_settings').select('value').eq('key', 'commission').maybeSingle();
  await supabase.from('events').update({ commission_pct: 2, commission_fixed_cents: 50 }).eq('id', ids.eventId);
  try {
    const c = await reserveSeats([ids.seats[4], ids.seats[5]]);
    const { data: pay } = await supabase.from('offline_payments').select('breakdown').eq('id', c.offlineId).single();
    // two seats at 500.00: 2% of 1,000.00 = 20.00, + 0.50 × 2 = 21.00
    assert.equal(pay.breakdown.commissionCents, 2000 + 100);
    assert.equal(pay.breakdown.buyerTotalCents, 100000, 'the buyer never pays the commission');

    await supabase.from('platform_settings').upsert({
      key: 'commission', value: { ...(before?.value || { default_pct: 1.5, default_tax_pct: 0 }), fixed_by_currency: { EGP: 500 } },
    }, { onConflict: 'key' });
    const terms = await ids.org('GET', '/organizer/fee-terms?country=EG&prices=20000');
    assert.equal(terms.status, 200, JSON.stringify(terms.body));
    assert.equal(terms.body.data.currency, 'EGP');
    assert.equal(terms.body.data.commissionFixedCents, 500);
    const two = terms.body.data.examples.find((e) => e.priceCents === 20000);
    const pct = terms.body.data.commissionPct;
    assert.equal(two.commissionCents, Math.round(20000 * pct / 100) + 500, 'the organizer\'s own price is priced exactly');
  } finally {
    if (before) await supabase.from('platform_settings').upsert({ key: 'commission', value: before.value }, { onConflict: 'key' });
    await supabase.from('events').update({ commission_pct: 1.5, commission_fixed_cents: 0 }).eq('id', ids.eventId);
  }
});

// ── The organizer decides: a receipt required (2026-11-24) ──────────────────
test('a method that requires a receipt: the buyer is told, and cannot finish without one', async () => {
  const set = await ids.org('PATCH', `/organizer/payment-methods/${ids.methodId}`, { requireProof: true });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.requireProof, true);
  try {
    const c = await reserveSeats([ids.seats[3]]);
    const q = `?token=${encodeURIComponent(c.token)}`;
    const view = await c.buyer('GET', `/public/offline-payments/${c.offlineId}${q}`);
    assert.equal(view.body.data.proofRequired, true, 'frozen onto the reservation');

    const early = await c.buyer('POST', `/public/offline-payments/${c.offlineId}/sent${q}`);
    assert.equal(early.status, 422);
    assert.equal(early.body.error, 'RECEIPT_REQUIRED');

    const { data: rec } = await supabase.rpc('offline_attach_proof', {
      p_offline_id: c.offlineId, p_path: `offline/${c.offlineId}/proof-req.png`, p_content_type: 'image/png',
    });
    assert.equal(rec.ok, true);
    const done = await c.buyer('POST', `/public/offline-payments/${c.offlineId}/sent${q}`);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.ok(done.body.data.sentAt);
  } finally {
    await ids.org('PATCH', `/organizer/payment-methods/${ids.methodId}`, { requireProof: false });
  }
});
