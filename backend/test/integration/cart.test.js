const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * The ticket cart (owner, 2026-11-17), against the real database:
 *
 *   · holds on several events live side by side, grouped by organizer;
 *   · adding more to an event in the cart replaces its hold with the combined
 *     selection, in one request, and a refused merge puts the original back;
 *   · a released or lapsed hold leaves the cart with a reason;
 *   · a guest's holds join the account when the cart is read signed in, and
 *     then follow the account without the device's tokens.
 */

const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const BUYER_EMAIL = `cart-buyer-${stamp}@eventsli-test.invalid`;
const ids = { profiles: [], organizers: [], events: [], maps: [] };
let server; let base;
const seat = {};       // event A's seat ids, s1..s6
const tier = {};

function client() {
  let cookie = null;
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const guest = client();
const buyer = client();

async function organizer(name) {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `cart-org-${name}-${stamp}@eventsli-test.invalid`, full_name: name, role: 'organizer',
  }).select('id').single();
  ids.profiles.push(profile.id);
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: name, country: 'CA',
    stripe_account_id: `acct_test_cart_${name}_${stamp}`,
  }).select('id').single();
  ids.organizers.push(org.id);
  return org.id;
}

async function event(orgId, key, { seated }) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: orgId, slug: `cart-${key}-${stamp}`, title: `Cart ${key}`,
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: seated ? 'reserved' : 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
    accepts_stripe: true,
  }).select('id, slug').single();
  if (error) throw new Error(`seed ${key}: ${error.message}`);
  ids.events.push(ev.id);
  return ev;
}

let A; let B; let C;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const one = await organizer('One');
  const two = await organizer('Two');
  A = await event(one, 'a', { seated: true });
  B = await event(one, 'b', { seated: false });
  C = await event(two, 'c', { seated: false });

  const { data: map } = await supabase.from('venue_maps').insert({ event_id: A.id, layout_json: {} }).select('id').single();
  ids.maps.push(map.id);
  const { data: t } = await supabase.from('ticket_tiers').insert({ event_id: A.id, name: 'Floor', price_cents: 5000 }).select('id').single();
  tier.a = t.id;
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 6 }, (_, i) => ({ venue_map_id: map.id, tier_id: t.id, section_key: 'Floor', row_label: 'A', seat_number: String(i + 1) })),
  ).select('id, seat_number');
  for (const s of seats) seat[`s${s.seat_number}`] = s.id;

  for (const [ev, key] of [[B, 'b'], [C, 'c']]) {
    const { data: gt } = await supabase.from('ticket_tiers').insert({ event_id: ev.id, name: 'General', price_cents: 0, quantity: 50 }).select('id').single();
    tier[key] = gt.id;
  }
});

after(async () => {
  for (const id of ids.events) {
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', id);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', id);
    await supabase.from('ticket_tiers').delete().eq('event_id', id);
  }
  for (const m of ids.maps) {
    await supabase.from('seats').delete().eq('venue_map_id', m);
    await supabase.from('venue_maps').delete().eq('id', m);
  }
  for (const id of ids.events) await supabase.from('events').delete().eq('id', id);
  for (const id of ids.organizers) await supabase.from('organizers').delete().eq('id', id);
  for (const id of ids.profiles) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

const tokens = {};
const held = {};

test('holds on several events live side by side, grouped by organizer', async () => {
  const a = await guest('POST', `/public/events/${A.slug}/hold`, { seatIds: [seat.s1, seat.s2] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await guest('POST', `/public/events/${B.slug}/hold`, { lines: [{ tierId: tier.b, quantity: 2 }] });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const c = await guest('POST', `/public/events/${C.slug}/hold`, { lines: [{ tierId: tier.c, quantity: 1 }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  Object.assign(tokens, { a: a.body.data.reservationToken, b: b.body.data.reservationToken, c: c.body.data.reservationToken });
  Object.assign(held, { a: a.body.data.reservationId, b: b.body.data.reservationId, c: c.body.data.reservationId });

  const cart = await guest('POST', '/public/cart', { tokens: Object.values(tokens) });
  assert.equal(cart.status, 200, JSON.stringify(cart.body));
  const { items, groups, count } = cart.body.data;
  assert.equal(items.length, 3, 'all three holds are still live');
  assert.equal(count, 5);
  assert.equal(groups.length, 2, 'one group per organizer');
  assert.deepEqual(groups.map((g) => g.items.length).sort(), [1, 2]);
  const itemA = items.find((i) => i.reservationId === held.a);
  assert.equal(itemA.totalCents >= 10000, true, 'the total is the checkout quote, fees and tax included');
  assert.equal(itemA.lines[0].label, 'Floor');
  assert.equal(itemA.lines[0].quantity, 2);
  assert.deepEqual(itemA.selection.seatIds.sort(), [seat.s1, seat.s2].sort());
});

test('adding more to an event in the cart replaces its hold with the combined one', async () => {
  const more = await guest('POST', `/public/events/${A.slug}/hold`,
    { seatIds: [seat.s1, seat.s2, seat.s3], replaces: held.a }, { 'x-replace-token': tokens.a });
  assert.equal(more.status, 201, JSON.stringify(more.body));
  assert.notEqual(more.body.data.reservationId, held.a);
  assert.equal(more.body.data.seatCount, 3);
  const { data: old } = await supabase.from('reservations').select('state').eq('id', held.a).single();
  assert.notEqual(old.state, 'active', 'the old hold is gone');
  held.a = more.body.data.reservationId;
  tokens.a = more.body.data.reservationToken;
});

test('a refused merge puts the original hold back', async () => {
  // Someone else takes seat 4.
  const { data: theirs } = await supabase.rpc('hold_seats', {
    p_event_id: A.id, p_user_id: null, p_seat_ids: [seat.s4], p_ttl_minutes: 35,
  });
  assert.equal(theirs.ok, true);

  const refused = await guest('POST', `/public/events/${A.slug}/hold`,
    { seatIds: [seat.s1, seat.s2, seat.s3, seat.s4], replaces: held.a }, { 'x-replace-token': tokens.a });
  assert.equal(refused.status >= 400, true, JSON.stringify(refused.body));
  const restored = refused.body.meta?.restored;
  assert.ok(restored, 'the original hold was placed again');
  assert.equal(restored.seatCount, 3);
  held.a = restored.reservationId;
  tokens.a = restored.reservationToken;

  const cart = await guest('POST', '/public/cart', { tokens: [tokens.a] });
  assert.deepEqual(cart.body.data.items[0].selection.seatIds.sort(), [seat.s1, seat.s2, seat.s3].sort());
});

test('a replace without proof is refused, and nothing is released', async () => {
  const forged = await guest('POST', `/public/events/${A.slug}/hold`,
    { seatIds: [seat.s5], replaces: held.a }, { 'x-replace-token': tokens.b });
  assert.equal(forged.status, 403);
  const { data: r } = await supabase.from('reservations').select('state').eq('id', held.a).single();
  assert.equal(r.state, 'active');
});

test('a released hold leaves the cart, with a reason', async () => {
  const rel = await guest('POST', `/public/reservations/${held.b}/release`, undefined, { 'x-access-token': tokens.b });
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  const cart = await guest('POST', '/public/cart', { tokens: [tokens.a, tokens.b] });
  assert.equal(cart.body.data.items.length, 1);
  assert.deepEqual(cart.body.data.gone, [{ reservationId: held.b, reason: 'expired' }]);
});

test("a guest's holds join the account, and then follow it to any device", async () => {
  const reg = await buyer('POST', '/auth/register', { email: BUYER_EMAIL, password: PASSWORD, fullName: 'Cart Buyer' });
  ids.profiles.push(reg.body.data.id);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', reg.body.data.id);
  await buyer('POST', '/auth/login', { email: BUYER_EMAIL, password: PASSWORD });

  const claimed = await buyer('POST', '/public/cart', { tokens: [tokens.c] });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.data.items.length, 1);

  // A second device: signed in, no tokens at all.
  const elsewhere = await buyer('POST', '/public/cart', {});
  assert.deepEqual(elsewhere.body.data.items.map((i) => i.reservationId), [held.c]);
  assert.ok(elsewhere.body.data.items[0].reservationToken, 'the owner is given a token to check out with');
});
