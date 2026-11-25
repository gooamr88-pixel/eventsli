const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const manual = require('../../services/manualPaymentService');
const tickets = require('../../services/ticketService');
const holders = require('../../services/ticketHolders');
const pricing = require('../../services/pricingService');

/**
 * PLACES AT A TABLE (2026-11-25, migrations 20261220090000/090100), against
 * the real database:
 *
 *   · a buyer asks for N places at a table and the server chooses the seats,
 *     lowest numbers first, through every seat-hold rule;
 *   · more places than are free is refused with how many are left;
 *   · a private table needs its key; the mode is refused on other events;
 *   · the table is never offered whole;
 *   · the ticket is issued with the table and NO seat — on the ticket, at the
 *     door — and the seat it took is kept only as stock;
 *   · voiding it puts the place back on sale;
 *   · the checkout and the cart name the table, never a seat.
 */

const stamp = Date.now();
const ids = { profiles: [], organizers: [], events: [], maps: [] };
let server; let base;
let ev; let seatOnly; let tier; let profileId;
const table = {};
const seatsAt = {};   // label → [seat ids by number]

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function makeEvent(orgId, key, mode) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data, error } = await supabase.from('events').insert({
    organizer_id: orgId, slug: `places-${key}-${stamp}`, title: `Places ${key}`,
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'reserved', purchase_mode: mode, max_tickets_per_order: 10,
    accepts_stripe: true, commission_pct: 10, commission_tax_pct: 0, event_tax_pct: 0,
  }).select('id, slug').single();
  if (error) throw new Error(`seed ${key}: ${error.message}`);
  ids.events.push(data.id);
  return data;
}

async function addTable(eventId, label, count, { isPrivate = false, tierId } = {}) {
  let { data: map } = await supabase.from('venue_maps').select('id').eq('event_id', eventId).maybeSingle();
  if (!map) {
    ({ data: map } = await supabase.from('venue_maps').insert({ event_id: eventId, layout_json: {} }).select('id').single());
    ids.maps.push(map.id);
  }
  const { data: t, error } = await supabase.from('tables').insert({
    venue_map_id: map.id, label, seat_count: count, tier_id: tierId, is_private: isPrivate, price_cents: 50000,
    ...(isPrivate ? { password_hash: 'scrypt$test$not-a-real-hash' } : {}),
  }).select('id').single();
  if (error) throw new Error(`table ${label}: ${error.message}`);
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: count }, (_, i) => ({
      venue_map_id: map.id, table_id: t.id, tier_id: tierId, section_key: label, row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id, seat_number');
  seatsAt[label] = seats.sort((a, b) => Number(a.seat_number) - Number(b.seat_number)).map((s) => s.id);
  return t.id;
}

const statusOf = async (seatId) => (await supabase.from('seats').select('status').eq('id', seatId).single()).data.status;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `places-org-${stamp}@eventsli-test.invalid`, full_name: 'Places Org', role: 'organizer',
  }).select('id').single();
  profileId = profile.id;
  ids.profiles.push(profile.id);
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Places Co', country: 'CA', stripe_account_id: `acct_test_places_${stamp}`,
  }).select('id').single();
  ids.organizers.push(org.id);

  ev = await makeEvent(org.id, 'gala', 'table_places');
  seatOnly = await makeEvent(org.id, 'seats', 'seat_only');
  ({ data: tier } = await supabase.from('ticket_tiers').insert({ event_id: ev.id, name: 'VIP', price_cents: 12500 }).select('id').single());
  const { data: other } = await supabase.from('ticket_tiers').insert({ event_id: seatOnly.id, name: 'Floor', price_cents: 5000 }).select('id').single();

  table.T5 = await addTable(ev.id, 'T5', 4, { tierId: tier.id });
  table.T6 = await addTable(ev.id, 'T6', 2, { tierId: tier.id });
  table.T7 = await addTable(ev.id, 'T7', 2, { tierId: tier.id, isPrivate: true });
  table.S1 = await addTable(seatOnly.id, 'S1', 2, { tierId: other.id });
});

after(async () => {
  for (const id of ids.events) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    for (const o of orders || []) await supabase.from('tickets').delete().eq('order_id', o.id);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', id);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', id);
  }
  for (const m of ids.maps) {
    await supabase.from('seats').delete().eq('venue_map_id', m);
    await supabase.from('tables').delete().eq('venue_map_id', m);
    await supabase.from('venue_maps').delete().eq('id', m);
  }
  // The ledger pins events with a sale; what can go, goes.
  for (const id of ids.events) {
    await supabase.from('ticket_tiers').delete().eq('event_id', id);
    await supabase.from('events').delete().eq('id', id);
  }
  for (const id of ids.organizers) await supabase.from('organizers').delete().eq('id', id);
  for (const id of ids.profiles) await supabase.from('profiles').delete().eq('id', id);
  await new Promise((r) => server.close(r));
});

let held;   // the T5 hold, used by the later tests

test('the seat map never offers a table whole at a places-at-a-table event', async () => {
  const res = await call('GET', `/public/events/${ev.slug}/seat-map`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const tables = res.body.data.tables.filter((t) => !t.locked);
  assert.ok(tables.length >= 2);
  assert.ok(tables.every((t) => t.canBookWhole === false), 'no table is bookable whole');
});

test('three places at T5: the server chooses seats 1–3 and holds them', async () => {
  const res = await call('POST', `/public/events/${ev.slug}/hold`, { tables: [{ tableId: table.T5, quantity: 3 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.seatCount, 3);
  assert.equal(res.body.data.subtotalCents, 3 * 12500);
  held = res.body.data;
  const states = await Promise.all(seatsAt.T5.map(statusOf));
  assert.deepEqual(states, ['held', 'held', 'held', 'available']);
});

test('more places than are free is refused, saying how many are left', async () => {
  const res = await call('POST', `/public/events/${ev.slug}/hold`, { tables: [{ tableId: table.T5, quantity: 2 }] });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'SEAT_UNAVAILABLE');
  assert.match(res.body.message, /Only 1 place is left at table T5/);
  // Nothing was taken by the refusal.
  assert.equal(await statusOf(seatsAt.T5[3]), 'available');
});

test('one table twice, a private table without its key, and another mode are all refused', async () => {
  const twice = await call('POST', `/public/events/${ev.slug}/hold`, {
    tables: [{ tableId: table.T6, quantity: 1 }, { tableId: table.T6, quantity: 1 }],
  });
  assert.equal(twice.status, 400, JSON.stringify(twice.body));

  const locked = await call('POST', `/public/events/${ev.slug}/hold`, { tables: [{ tableId: table.T7, quantity: 1 }] });
  assert.equal(locked.status, 403, JSON.stringify(locked.body));
  assert.equal(locked.body.error, 'TABLE_PASSWORD_REQUIRED');

  const wrongMode = await call('POST', `/public/events/${seatOnly.slug}/hold`, { tables: [{ tableId: table.S1, quantity: 1 }] });
  assert.equal(wrongMode.status, 400, JSON.stringify(wrongMode.body));
  assert.match(wrongMode.body.message, /does not book places at a table/);
});

test('the checkout, the holder forms and the cart name the table, never a seat', async () => {
  const q = await pricing.quoteReservation(held.reservationId);
  const slots = await holders.forCheckout(q);
  assert.equal(slots.slots.length, 3, JSON.stringify(slots));
  assert.ok(slots.slots.every((s) => s.place === 'Table T5'), JSON.stringify(slots.slots));
  const quote = await call('GET', `/public/reservations/${held.reservationId}/quote`, null, { 'x-access-token': held.reservationToken });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.deepEqual(quote.body.data.tickets.map((l) => [l.name, l.quantity]), [['VIP · Table T5', 3]]);

  const cart = await call('POST', '/public/cart', { tokens: [held.reservationToken] });
  assert.equal(cart.status, 200, JSON.stringify(cart.body));
  const item = cart.body.data.items.find((i) => i.reservationId === held.reservationId);
  assert.deepEqual(item.lines.filter((l) => l.kind !== 'addon').map((l) => [l.kind, l.label, l.quantity, l.tiers]),
    [['places', 'Table T5', 3, ['VIP']]]);
});

test('a ticket is issued with the table and no seat; voiding it puts the place back', async () => {
  // A door sale is one of the four paths that issue tickets; the trigger
  // treats them all the same.
  const sale = await manual.recordSale({
    eventId: ev.id, seatIds: [seatsAt.T6[0]], buyer: { name: 'Table Guest' }, method: 'cash', recordedBy: profileId,
  });
  const { data: [row] } = await supabase.from('tickets')
    .select('seat_id, table_id, place_seat_id, issued_table_label, issued_section, issued_seat_number')
    .eq('order_id', sale.order_id);
  assert.deepEqual(row, {
    seat_id: null, table_id: table.T6, place_seat_id: seatsAt.T6[0],
    issued_table_label: 'T6', issued_section: null, issued_seat_number: null,
  });
  assert.equal(await statusOf(seatsAt.T6[0]), 'sold');

  // What the buyer's ticket says.
  const [shown] = await tickets.forOrder(sale.order_id);
  assert.equal(shown.seat, null);
  assert.equal(shown.table, 'T6');

  // What the door says.
  const { data: door, error } = await supabase.rpc('event_door_list', { p_event_id: ev.id, p_q: 'Table Guest' });
  assert.ifError(error);
  const entry = JSON.stringify(door);
  assert.match(entry, /"table": ?"T6"/);
  assert.match(entry, /"seat": ?null/);

  // A void gives the place back to the table.
  const { data: v, error: vErr } = await supabase.rpc('order_void_offline', {
    p_order_id: sale.order_id, p_organizer_id: null, p_actor: null, p_role: 'admin', p_kind: 'void', p_reason: 'Recorded in error',
  });
  assert.ifError(vErr);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(await statusOf(seatsAt.T6[0]), 'available');
});
