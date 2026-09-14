const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const accessTokens = require('../../services/accessTokens');

/**
 * Who can reach a ticket, and who cannot.
 *
 * The audit found the QR codes reachable by anyone holding a Stripe session id
 * — a value that travels in the URL bar, browser history and `Referer` headers.
 * These pin the three ways in and the boundaries around them.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let seatIds = [];
const BUYER = `tbuyer-${stamp}@eventsli-test.invalid`;

/**
 * Registers, confirms the address as the emailed code would, and signs in.
 * Registering no longer signs anyone in on its own.
 */
async function registerAndSignIn({ email, fullName }) {
  const password = 'a-perfectly-long-passphrase';
  const reg = await call('POST', '/auth/register', { email, password, fullName });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', reg.body.data.id);
  const login = await call('POST', '/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id: reg.body.data.id, cookie: login.cookie.split(';')[0] };
}

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || 'null'),
           cookie: res.headers.get('set-cookie') };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `tacc-${stamp}@eventsli-test.invalid`, full_name: 'Acc Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Acc Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `tacc-${stamp}`, title: 'Ticket Access Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 15 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 15 * 86400e3 + 3600e3).toISOString(),
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

  const { data: s } = await supabase.from('seats').insert(
    Array.from({ length: 6 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');
  seatIds = s.map((r) => r.id);

  // A real paid order, so the tickets under test are the ones fulfilment issues.
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: seatIds.slice(0, 2), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.reservation_id);
  const { data: filled } = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.reservation_id, p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Ticket Buyer', email: BUYER },
    p_stripe: { session_id: `cs_tacc_${stamp}` },
  });
  ids.order = filled.order_id;
});

after(async () => {
  if (ids.event) {
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
  for (const id of [ids.profile, ids.buyerAccount].filter(Boolean)) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

// ── The emailed link ────────────────────────────────────────────────────────

test('a signed order token yields the tickets', async () => {
  const token = accessTokens.issueOrderToken(ids.order);
  const res = await call('GET', `/public/t/${encodeURIComponent(token)}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.orderId, ids.order);
  assert.equal(res.body.data.tickets.length, 2);
  assert.ok(res.body.data.tickets[0].qr, 'the QR is the point of the link');
});

test('a forged token yields nothing', async () => {
  const real = accessTokens.issueOrderToken(ids.order);
  for (const junk of ['a'.repeat(40), `${real.slice(0, -5)}AAAAA`]) {
    const res = await call('GET', `/public/t/${encodeURIComponent(junk)}`);
    assert.equal(res.status, 401, `"${junk.slice(0, 10)}…" should be refused`);
    assert.equal(res.text.includes('"qr"'), false, 'and must leak no code');
  }
});

test('a token too short to be one is refused before the handler', async () => {
  // Cheaper: a flood of junk never becomes a flood of signature checks.
  const res = await call('GET', '/public/t/x.y.z');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
});

test('a session cookie cannot be replayed as an order token', async () => {
  // Both are signed with JWT_SECRET; only `typ` separates them.
  const jwt = require('jsonwebtoken');
  const sessionish = jwt.sign({ sub: 'someone', jti: 'x' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const res = await call('GET', `/public/t/${encodeURIComponent(sessionish)}`);
  assert.equal(res.status, 401);
});

test('an order token opens ONE order, not any other', async () => {
  const { data: other } = await supabase.from('orders').insert({
    event_id: ids.event, organizer_id: ids.organizer, channel: 'manual', status: 'paid',
    currency: 'CAD', quantity: 1, subtotal_cents: 4000, buyer_total_cents: 4000,
    organizer_net_cents: 4000, fee_bearer: 'organizer', guest_name: 'Someone Else',
  }).select('id').single();

  const token = accessTokens.issueOrderToken(ids.order);
  const res = await call('GET', `/public/t/${encodeURIComponent(token)}`);
  assert.equal(res.body.data.orderId, ids.order);
  assert.notEqual(res.body.data.orderId, other.id);

  await supabase.from('orders').delete().eq('id', other.id);
});

// ── The QR image ────────────────────────────────────────────────────────────

test('the QR image is rendered by us, from a token we signed', async () => {
  // It used to be an <img> at api.qrserver.com with the admission token in the
  // query string — the credential that opens the door, in a third party's logs,
  // for every ticket ever sold.
  const token = accessTokens.issueOrderToken(ids.order);
  const order = await call('GET', `/public/t/${encodeURIComponent(token)}`);
  const qr = order.body.data.tickets[0].qr;

  const res = await fetch(`${baseUrl}/public/qr/${encodeURIComponent(qr)}.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');

  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a real PNG');
  assert.ok(bytes.length > 200, 'with something drawn in it');

  // The URL carries the credential, so nothing may hold a copy of it.
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('it will not draw a QR for anything we did not sign', async () => {
  // Otherwise this is a "turn any string into a QR image" endpoint on our own
  // domain, which is a phishing tool with our name on it.
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ typ: 'ticket', tid: 'x', eid: 'y' }, 'not-our-secret');
  const wrongType = jwt.sign(
    { typ: 'order_access', oid: ids.order }, process.env.QR_JWT_SECRET, { algorithm: 'HS256' },
  );

  for (const bad of [forged, wrongType, 'https://example.com/phishing-page-here']) {
    const res = await fetch(`${baseUrl}/public/qr/${encodeURIComponent(bad)}.png`);
    assert.ok(res.status === 404 || res.status === 400, `${res.status} for ${bad.slice(0, 24)}…`);
    assert.notEqual(res.headers.get('content-type'), 'image/png');
  }
});

test('the ticket email points at our own domain for the code', async () => {
  const emailService = require('../../services/emailService');
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 201, text: async () => '' };
  };
  try {
    process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || 'test-key';
    process.env.BACKEND_URL = 'https://api.eventsli.test';
    await emailService.sendTickets({
      to: BUYER, buyerName: 'Ticket Buyer',
      event: { title: 'Ticket Access Test' },
      tickets: [{ qr: accessTokens.issueOrderToken(ids.order), seat: 'A1' }],
      order: { buyer_total_cents: 4000, currency: 'CAD' },
    });
  } finally { global.fetch = realFetch; }

  assert.equal(sent.length, 1, 'the mail must have been attempted');
  const html = sent[0].htmlContent;
  assert.equal(html.includes('qrserver.com'), false, 'no third-party QR service');
  assert.ok(html.includes('https://api.eventsli.test/api/v1/public/qr/'), html.slice(0, 400));
});

// ── The signed-in route ─────────────────────────────────────────────────────

test('/tickets needs a session', async () => {
  const res = await call('GET', '/tickets');
  assert.equal(res.status, 401);
});

test('a buyer who later registers still sees the tickets they bought as a guest', async () => {
  // Matched on the purchase address as well as the account id — otherwise
  // someone who signs up after buying sees an empty list and assumes their
  // purchase vanished.
  const buyer = await registerAndSignIn({ email: BUYER, fullName: 'Ticket Buyer' });
  ids.buyerAccount = buyer.id;
  const { cookie } = buyer;

  const res = await call('GET', '/tickets', null, { cookie });
  assert.equal(res.status, 200);
  const order = res.body.data.find((o) => o.orderId === ids.order);
  assert.ok(order, 'the guest purchase must appear');
  assert.equal(order.tickets.length, 2);
});

test('a different account sees none of them', async () => {
  const stranger = await registerAndSignIn({
    email: `stranger-${stamp}@eventsli-test.invalid`, fullName: 'A Stranger',
  });
  const { cookie } = stranger;
  const other = { body: { data: { id: stranger.id } } };

  const res = await call('GET', '/tickets', null, { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.some((o) => o.orderId === ids.order), false);
  assert.equal(res.text.includes(BUYER), false, 'and learns nothing about the buyer');

  await supabase.from('sessions').delete().eq('user_id', other.body.data.id);
  await supabase.from('profiles').delete().eq('id', other.body.data.id);
});

// ── Resend ──────────────────────────────────────────────────────────────────

test('resend answers identically whether or not the address has tickets', async () => {
  // Otherwise this endpoint is a directory: type an address, learn whether that
  // person bought a ticket to this event.
  const real = await call('POST', '/public/tickets/resend', { email: BUYER });
  const fake = await call('POST', '/public/tickets/resend', {
    email: `nobody-${stamp}@eventsli-test.invalid`,
  });

  assert.equal(real.status, fake.status);
  assert.deepEqual(real.body, fake.body);
});

test('resend never mails to an address supplied for someone else\'s order', async () => {
  // It sends to the address ON THE ORDER. There is no parameter that redirects
  // it, which is what stops it mailing anyone's tickets to anyone.
  const res = await call('POST', '/public/tickets/resend', { email: BUYER });
  assert.equal(res.status, 200);
  assert.equal(res.text.includes('"qr"'), false, 'the reply carries no codes');
  assert.equal(res.text.includes(BUYER), false, 'and does not echo the address back');
});

// ── The hold token ──────────────────────────────────────────────────────────

test('a hold cannot be released by someone who did not make it', async () => {
  const hold = await call('POST', `/public/events/${ids.slug}/hold`, { seatIds: [seatIds[3]] });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const { reservationId, reservationToken } = hold.body.data;
  assert.ok(reservationToken, 'the hold must hand back proof');

  // A stranger with the id alone — which travels to the client and can be
  // picked up from a log or a shared screen.
  const stranger = await call('POST', `/public/reservations/${reservationId}/release`);
  assert.equal(stranger.status, 403);

  const { data: seat } = await supabase.from('seats').select('status').eq('id', seatIds[3]).single();
  assert.equal(seat.status, 'held', 'the seats must still be held');

  // The holder can.
  const owner = await call('POST', `/public/reservations/${reservationId}/release`, null,
    { 'x-access-token': reservationToken });
  assert.equal(owner.status, 200);

  const { data: after_ } = await supabase.from('seats').select('status').eq('id', seatIds[3]).single();
  assert.equal(after_.status, 'available');
});

test('a token for one hold does not release another', async () => {
  const a = await call('POST', `/public/events/${ids.slug}/hold`, { seatIds: [seatIds[4]] });
  const b = await call('POST', `/public/events/${ids.slug}/hold`, { seatIds: [seatIds[5]] });

  const crossed = await call('POST', `/public/reservations/${b.body.data.reservationId}/release`, null,
    { 'x-access-token': a.body.data.reservationToken });
  assert.equal(crossed.status, 403);

  for (const h of [a, b]) {
    await call('POST', `/public/reservations/${h.body.data.reservationId}/release`, null,
      { 'x-access-token': h.body.data.reservationToken });
  }
});
