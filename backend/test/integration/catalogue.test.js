const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * Ticket tiers and table categories — the two things an organizer could not
 * create through the API at all until now.
 *
 * The tier tests matter more than they look. `seat_price_cents` resolves a seat
 * as COALESCE(price_override_cents, tier.price_cents, 0), so anything that
 * detaches a seat from its tier prices that seat at NOTHING. Deleting a tier
 * that seats point at is the obvious way to do that by accident, and
 * `seats.tier_id` is ON DELETE SET NULL, so the database will happily allow it.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let cookie;
const PASSWORD = 'a-perfectly-long-passphrase';

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || 'null') };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const email = `cat-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: 'Catalogue Test' }),
  });
  ids.profile = (await reg.json()).data.id;
  await supabase.from('profiles').update({ role: 'organizer' }).eq('id', ids.profile);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookie = login.headers.get('set-cookie').split(';')[0];

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.profile, display_name: 'Catalogue Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: ids.profile, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `cat-${stamp}`, title: 'Catalogue Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 45 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 45 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  // A second organizer's event, to prove one cannot reach the other's tiers.
  const { data: other } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `cat-other-${stamp}`, title: 'Someone Else',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 46 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 46 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'draft', terms_accepted_id: terms.id,
  }).select('id').single();
  ids.otherEvent = other.id;
});

after(async () => {
  for (const eventId of [ids.event, ids.otherEvent].filter(Boolean)) {
    const { data: m } = await supabase.from('venue_maps')
      .select('id').eq('event_id', eventId).maybeSingle();
    if (m) {
      await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('tables').delete().eq('venue_map_id', m.id);
      await supabase.from('venue_maps').delete().eq('id', m.id);
    }
    await supabase.from('table_categories').delete().eq('event_id', eventId);
    await supabase.from('ticket_tiers').delete().eq('event_id', eventId);
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

// ── Tiers ───────────────────────────────────────────────────────────────────

test('a tier is created and priced in whole cents', async () => {
  const res = await call('POST', `/events/${ids.event}/tiers`, {
    name: 'General Admission', description: 'Standing', priceCents: 4000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.priceCents, 4000);
  assert.equal(res.body.data.soldCount, 0);
  // NULL quantity is "bounded by the seat map", not "none left". A client that
  // renders it as 0 shows a brand new event as sold out.
  assert.equal(res.body.data.quantity, null);
  assert.equal(res.body.data.remaining, null);
  ids.tier = res.body.data.id;
});

test('a fractional price is refused rather than rounded silently', async () => {
  const res = await call('POST', `/events/${ids.event}/tiers`,
    { name: 'Fractional', priceCents: 39.99 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
});

test('two tiers cannot share a name, whatever the case', async () => {
  const res = await call('POST', `/events/${ids.event}/tiers`,
    { name: 'general admission', priceCents: 9900 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'DUPLICATE_TIER');
});

test('tiers come back in the organizer\'s order, not the database\'s', async () => {
  await call('POST', `/events/${ids.event}/tiers`, { name: 'VIP', priceCents: 12000, sortOrder: 1 });
  await call('PATCH', `/events/${ids.event}/tiers/${ids.tier}`, { sortOrder: 2 });

  const res = await call('GET', `/events/${ids.event}/tiers`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((t) => t.name), ['VIP', 'General Admission']);
  ids.vip = res.body.data[0].id;
});

test('a tier on another event is not reachable by pairing ids', async () => {
  // verifyEventOwner proves the caller owns the EVENT and says nothing about
  // whether this tier id belongs to it.
  const { data: foreign } = await supabase.from('ticket_tiers')
    .insert({ event_id: ids.otherEvent, name: 'Not Yours', price_cents: 5000 })
    .select('id').single();

  const res = await call('PATCH', `/events/${ids.event}/tiers/${foreign.id}`, { priceCents: 1 });
  assert.equal(res.status, 404);

  const { data } = await supabase.from('ticket_tiers')
    .select('price_cents').eq('id', foreign.id).single();
  assert.equal(Number(data.price_cents), 5000, 'and it must be untouched');
});

test('deleting a tier that prices seats is refused', async () => {
  // seats.tier_id is ON DELETE SET NULL, so the database allows this happily —
  // and every one of those seats would then resolve through
  // COALESCE(..., ..., 0) and sell for nothing.
  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ids.event, layout_json: {} }).select('id').single();
  ids.map = map.id;
  await supabase.from('seats').insert(
    Array.from({ length: 3 }, (_, i) => ({
      venue_map_id: map.id, tier_id: ids.tier,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  );

  const res = await call('DELETE', `/events/${ids.event}/tiers/${ids.tier}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'TIER_IN_USE');
  assert.match(res.body.message, /3 seats/);

  const { data: still } = await supabase.from('ticket_tiers')
    .select('id').eq('id', ids.tier).maybeSingle();
  assert.ok(still, 'the tier must survive the refusal');

  // And the seats must still be priced by it.
  const { data: priced } = await supabase.rpc('seat_price_cents', {
    p_seat_id: (await supabase.from('seats').select('id').eq('tier_id', ids.tier).limit(1).single()).data.id,
  });
  assert.equal(Number(priced), 4000, 'a seat must not have quietly become free');
});

test('an unused tier deletes cleanly', async () => {
  const made = await call('POST', `/events/${ids.event}/tiers`,
    { name: 'Temporary', priceCents: 100 });
  const res = await call('DELETE', `/events/${ids.event}/tiers/${made.body.data.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.deleted, true);
});

test('the price freezes once a ticket has sold at it', async () => {
  // BRD §13. Enforced by lock_tier_price_after_sale, and this asserts the
  // controller reports it as a 409 an organizer can act on rather than a 500.
  const { data: order } = await supabase.from('orders').insert({
    event_id: ids.event, organizer_id: ids.organizer, channel: 'manual', status: 'paid',
    currency: 'CAD', quantity: 1, subtotal_cents: 4000, buyer_total_cents: 4000,
    organizer_net_cents: 4000, fee_bearer: 'organizer', guest_name: 'A Buyer',
    guest_email: `frozen-${stamp}@eventsli-test.invalid`,
  }).select('id').single();
  const { data: ticket } = await supabase.from('tickets').insert({
    order_id: order.id, event_id: ids.event, tier_id: ids.tier,
  }).select('id').single();

  const res = await call('PATCH', `/events/${ids.event}/tiers/${ids.tier}`, { priceCents: 9900 });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.error, 'PRICE_LOCKED_AFTER_SALE');
  assert.match(res.body.message, /new tier/i, 'and it must say what to do instead');

  // Everything else about the tier is still editable — only the price froze.
  const rename = await call('PATCH', `/events/${ids.event}/tiers/${ids.tier}`,
    { description: 'Standing, general area' });
  assert.equal(rename.status, 200);

  await supabase.from('tickets').delete().eq('id', ticket.id);
  await supabase.from('orders').delete().eq('id', order.id);
});

// ── Table categories ────────────────────────────────────────────────────────

test('a category is created with a colour', async () => {
  const res = await call('POST', `/events/${ids.event}/table-categories`,
    { name: 'Front row', color: '#047857' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.color, '#047857');
  assert.equal(res.body.data.tableCount, 0);
  ids.category = res.body.data.id;
});

test('a colour that is not a hex value is refused', async () => {
  for (const color of ['red', 'javascript:alert(1)', '#fff', '#12345g']) {
    const res = await call('POST', `/events/${ids.event}/table-categories`,
      { name: `C-${color}`, color });
    assert.equal(res.status, 400, `"${color}" should be refused`);
  }
});

test('the same name twice is refused by the database, not by a race', async () => {
  const res = await call('POST', `/events/${ids.event}/table-categories`, { name: 'Front row' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'DUPLICATE_CATEGORY');
});

test('the listing counts the tables using each category', async () => {
  await supabase.from('tables').insert([
    { venue_map_id: ids.map, label: 'T1', seat_count: 4, category_id: ids.category },
    { venue_map_id: ids.map, label: 'T2', seat_count: 4, category_id: ids.category },
    { venue_map_id: ids.map, label: 'T3', seat_count: 4 },
  ]);

  const res = await call('GET', `/events/${ids.event}/table-categories`);
  assert.equal(res.status, 200);
  const front = res.body.data.find((c) => c.id === ids.category);
  assert.equal(front.tableCount, 2);
});

test('deleting a category leaves its tables priced exactly as they were', async () => {
  // Unlike a tier: a category carries no price, so ON DELETE SET NULL is safe
  // here and the tables simply become uncategorised.
  const { data: before_ } = await supabase.from('tables')
    .select('id, price_cents').eq('category_id', ids.category);

  const res = await call('DELETE', `/events/${ids.event}/table-categories/${ids.category}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.tablesUncategorised, 2, 'and it must say how many it affected');

  for (const t of before_) {
    const { data: after_ } = await supabase.from('tables')
      .select('category_id, price_cents').eq('id', t.id).single();
    assert.equal(after_.category_id, null);
    assert.equal(after_.price_cents, t.price_cents, 'the price must not have moved');
  }
});
