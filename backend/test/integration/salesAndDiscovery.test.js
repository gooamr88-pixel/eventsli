const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const manual = require('../../services/manualPaymentService');

/**
 * What the organizer sold, who is coming, and how anyone finds the event.
 *
 * `/manual-sales` filters channel = 'manual', so until `/orders` existed an
 * organizer could see the cash taken at the door and nothing sold online. And
 * `/public/events/:slug/seat-map` was the only public read, so the platform
 * could sell to anyone who already had the link and to nobody else.
 *
 * The sharp edges under test:
 *   • an unpublished event must be invisible, and invisible in the SAME way as
 *     one that does not exist;
 *   • the door list must not carry the QR codes;
 *   • the totals must cover the whole filtered set, not the page on screen.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let cookie;
const PASSWORD = 'a-perfectly-long-passphrase';
const BUYER = `sales-buyer-${stamp}@eventsli-test.invalid`;

const call = async (method, path, body, withCookie = true) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie && cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || 'null') };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const email = `sales-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: 'Sales Test' }),
  });
  ids.profile = (await reg.json()).data.id;
  // Confirmed as the emailed code would, so the account can sign in. The code
  // path itself is tested in authFlow.test.js.
  await supabase.from('profiles')
    .update({ role: 'organizer', email_verified_at: new Date().toISOString() })
    .eq('id', ids.profile);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookie = login.headers.get('set-cookie').split(';')[0];

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.profile, display_name: 'Sales Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: ids.profile, terms_id: terms.id });

  const base = {
    organizer_id: org.id, country: 'CA', timezone: 'America/Toronto',
    currency: 'CAD', terms_accepted_id: terms.id, purchase_mode: 'seat_only',
  };

  const { data: ev, error } = await supabase.from('events').insert({
    ...base, slug: `sales-${stamp}`, title: `Findable Concert ${stamp}`,
    description: 'A real description.', venue_name: 'The Test Hall',
    starts_at: new Date(Date.now() + 50 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 50 * 86400e3 + 3600e3).toISOString(),
    status: 'published',
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id; ids.slug = ev.slug;

  // One of each state that must stay invisible.
  for (const [key, status] of [['draft', 'draft'], ['pending', 'pending_review'],
                               ['suspended', 'suspended'], ['cancelled', 'cancelled']]) {
    const { data } = await supabase.from('events').insert({
      ...base, slug: `sales-${key}-${stamp}`, title: `Hidden ${key} ${stamp}`,
      starts_at: new Date(Date.now() + 51 * 86400e3).toISOString(),
      ends_at: new Date(Date.now() + 51 * 86400e3 + 3600e3).toISOString(),
      status,
    }).select('id, slug').single();
    ids[`${key}Event`] = data.id;
    ids[`${key}Slug`] = data.slug;
  }

  // A past event, to prove the default excludes it.
  const { data: past } = await supabase.from('events').insert({
    ...base, slug: `sales-past-${stamp}`, title: `Past Concert ${stamp}`,
    starts_at: new Date(Date.now() - 10 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() - 10 * 86400e3 + 3600e3).toISOString(),
    status: 'published',
  }).select('id, slug').single();
  ids.pastEvent = past.id;

  // Stock, then two real orders — one online, one at the door.
  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'GA', price_cents: 5000 }).select('id').single();

  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 8 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');
  ids.seats = seats.map((s) => s.id);

  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: ids.seats.slice(0, 3), p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.reservation_id);
  const { data: filled } = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.reservation_id, p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Online Buyer', email: BUYER },
    p_stripe: { session_id: `cs_sales_${stamp}` },
  });
  ids.stripeOrder = filled.order_id;

  const door = await manual.recordSale({
    eventId: ev.id,
    seatIds: ids.seats.slice(3, 5),
    buyer: { name: 'Door Buyer', email: null, phone: null },
    method: 'cash',
    note: 'paid at the door',
    recordedBy: ids.profile,
  });
  ids.manualOrder = door.orderId || door.order_id;
});

after(async () => {
  const events = ['event', 'draftEvent', 'pendingEvent', 'suspendedEvent',
                  'cancelledEvent', 'pastEvent'].map((k) => ids[k]).filter(Boolean);
  for (const eventId of events) {
    await supabase.from('tickets').delete().eq('event_id', eventId);
    await supabase.from('ledger_entries').delete().eq('event_id', eventId);
    const { data: os } = await supabase.from('orders').select('id').eq('event_id', eventId);
    for (const o of os || []) await supabase.from('order_items').delete().eq('order_id', o.id);
    await supabase.from('orders').delete().eq('event_id', eventId);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', eventId);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', eventId);
    const { data: m } = await supabase.from('venue_maps')
      .select('id').eq('event_id', eventId).maybeSingle();
    if (m) {
      await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('tables').delete().eq('venue_map_id', m.id);
      await supabase.from('venue_maps').delete().eq('id', m.id);
    }
    await supabase.from('ticket_tiers').delete().eq('event_id', eventId);
    await supabase.from('invoices').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('sessions').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

// ── Orders: both channels, in one list ──────────────────────────────────────

test('the order list shows online sales, which manual-sales never did', async () => {
  const res = await call('GET', `/events/${ids.event}/orders`);
  assert.equal(res.status, 200, res.text);

  const ids_ = res.body.data.map((o) => o.id);
  assert.ok(ids_.includes(ids.stripeOrder), 'the Stripe order must appear');
  assert.ok(ids_.includes(ids.manualOrder), 'and so must the manual one');

  const online = res.body.data.find((o) => o.id === ids.stripeOrder);
  assert.equal(online.channel, 'stripe');
  assert.equal(online.tickets, 3);
  assert.equal(online.buyer.email, BUYER);
});

test('the totals cover the whole filtered set, not the page', async () => {
  // A footer that sums the rows on screen and calls it revenue is worse than no
  // footer, because it looks like an answer.
  const page = await call('GET', `/events/${ids.event}/orders?limit=1`);
  assert.equal(page.status, 200);
  assert.equal(page.body.data.length, 1, 'one row on the page');

  const cad = page.body.meta.totals.CAD;
  assert.equal(cad.orders, 2, 'but two orders in the totals');
  assert.equal(cad.tickets, 5);
  assert.equal(page.body.meta.byChannel.stripe, 1);
  assert.equal(page.body.meta.byChannel.manual, 1);
});

test('the channel filter still works, and moves the totals with it', async () => {
  const res = await call('GET', `/events/${ids.event}/orders?channel=stripe`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.meta.totals.CAD.orders, 1);
  assert.equal(res.body.meta.totals.CAD.tickets, 3);
});

test('an abandoned checkout is not counted as a sale', async () => {
  const { data: pending } = await supabase.from('orders').insert({
    event_id: ids.event, organizer_id: ids.organizer, channel: 'stripe', status: 'pending',
    currency: 'CAD', quantity: 2, subtotal_cents: 10000, buyer_total_cents: 10000,
    organizer_net_cents: 10000, fee_bearer: 'buyer', guest_email: `abandoned-${stamp}@x.invalid`,
  }).select('id').single();

  const paid = await call('GET', `/events/${ids.event}/orders`);
  assert.equal(paid.body.data.some((o) => o.id === pending.id), false);
  assert.equal(paid.body.meta.totals.CAD.orders, 2);

  const all = await call('GET', `/events/${ids.event}/orders?status=all`);
  assert.equal(all.body.data.some((o) => o.id === pending.id), true, '?status=all shows it');

  await supabase.from('orders').delete().eq('id', pending.id);
});

test('a buyer search is treated as text, not as filter syntax', async () => {
  const res = await call('GET', '/events/' + ids.event + '/orders?q=x,status.eq.pending)');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 0, 'the injected filter must not have applied');
});

// ── Attendees: the door list ────────────────────────────────────────────────

test('the door list is one row per ticket, with its seat', async () => {
  const res = await call('GET', `/events/${ids.event}/attendees`);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.pagination.total, 5, 'five tickets across the two orders');

  const row = res.body.data.find((a) => a.orderId === ids.stripeOrder);
  assert.ok(row.seat, `a seat label is the point of a door list: ${JSON.stringify(row)}`);
  assert.equal(row.name, 'Online Buyer', 'falling back to the buyer when no attendee is named');
  assert.equal(row.checkedIn, false);
});

test('the door list carries no QR codes', async () => {
  // Putting the admission credential for every ticket into a paginated list an
  // organizer can screenshot would make it a bearer token for the whole event.
  const res = await call('GET', `/events/${ids.event}/attendees`);
  assert.equal(res.text.includes('"qr"'), false);
  // A JWT in the body would show up as three base64 segments.
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}\./.test(res.text), false, 'no signed token of any kind');
});

test('checked-in filtering answers the two questions asked at a door', async () => {
  const { data: t } = await supabase.from('tickets')
    .select('id').eq('order_id', ids.stripeOrder).limit(1).single();
  await supabase.from('tickets')
    .update({ scanned_at: new Date().toISOString() }).eq('id', t.id);

  const inside = await call('GET', `/events/${ids.event}/attendees?checkedIn=true`);
  assert.equal(inside.body.data.length, 1);
  assert.equal(inside.body.data[0].ticketId, t.id);
  assert.equal(inside.body.data[0].checkedIn, true);

  const outside = await call('GET', `/events/${ids.event}/attendees?checkedIn=false`);
  assert.equal(outside.body.data.length, 4);
  assert.equal(inside.body.meta.admitted, 1);

  await supabase.from('tickets').update({ scanned_at: null }).eq('id', t.id);
});

test('another organizer cannot read either list', async () => {
  const res = await fetch(`${baseUrl}/events/${ids.event}/orders`);
  assert.equal(res.status, 401);
});

// ── Discovery ───────────────────────────────────────────────────────────────

test('a published event is findable by search', async () => {
  const res = await call('GET', `/public/events?q=Findable Concert ${stamp}`, null, false);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.data.length, 1, JSON.stringify(res.body.data));
  assert.equal(res.body.data[0].slug, ids.slug);
  assert.equal(res.body.data[0].organizer.name, 'Sales Co');
});

test('every unpublished state is invisible, and invisible the same way', async () => {
  // A distinguishable answer lets anyone enumerate slugs and watch an event move
  // through review, or learn that a named organizer was rejected.
  const answers = [];
  for (const key of ['draft', 'pending', 'suspended', 'cancelled']) {
    const res = await call('GET', `/public/events/${ids[`${key}Slug`]}`, null, false);
    assert.equal(res.status, 404, `${key} must 404`);
    answers.push(res.text);
  }
  const missing = await call('GET', `/public/events/no-such-event-${stamp}`, null, false);
  assert.equal(missing.status, 404);
  answers.push(missing.text);

  assert.equal(new Set(answers).size, 1, 'all five answers must be byte-identical');
});

test('an unpublished event is absent from the listing too', async () => {
  const res = await call('GET', `/public/events?q=Hidden`, null, false);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 0);
});

test('past events are excluded by default and available on request', async () => {
  const soon = await call('GET', `/public/events?q=Concert ${stamp}`, null, false);
  assert.equal(soon.body.data.length, 1, 'only the upcoming one');

  const all = await call('GET', `/public/events?q=Concert ${stamp}&includePast=true`, null, false);
  assert.equal(all.body.data.length, 2);
});

test('the listing is soonest-first, which a browsing visitor wants', async () => {
  const res = await call('GET', `/public/events?q=Concert ${stamp}&includePast=true`, null, false);
  const dates = res.body.data.map((e) => new Date(e.startsAt).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b));
});

test('the event page carries its tiers and an availability signal', async () => {
  const res = await call('GET', `/public/events/${ids.slug}`, null, false);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, `Findable Concert ${stamp}`);
  assert.equal(res.body.data.description, 'A real description.');
  assert.equal(res.body.data.tiers.length, 1);
  assert.equal(res.body.data.tiers[0].priceCents, 5000);

  // 8 seats, 5 sold.
  assert.equal(res.body.data.availability.seatsTotal, 8);
  assert.equal(res.body.data.availability.seatsAvailable, 3);
  assert.equal(res.body.data.availability.soldOut, false);
});

test('the public page leaks nothing about the organizer or our margin', async () => {
  const res = await call('GET', `/public/events/${ids.slug}`, null, false);
  for (const leak of ['commission', 'payment_fee', 'paymentFee', 'stripe',
                      'owner_user_id', 'organizer_id', 'is_banned']) {
    assert.equal(res.text.toLowerCase().includes(leak.toLowerCase()), false,
      `"${leak}" must not appear on a public page`);
  }
});
