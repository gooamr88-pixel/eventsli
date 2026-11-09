const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const venue = require('../../services/venueService');
const manual = require('../../services/manualPaymentService');

/**
 * Seating, ticket types and selling — the findings of the 2026-11-09 audit
 * (docs/TECH-AUDIT-LOG.md, "Seating, pricing and checkout audit", S-01..S-21).
 *
 * Each test below failed on the code as it stood before that remediation, and
 * names the finding it guards. They drive the services and the database
 * functions directly, as `venueMap.test.js` does, and the public seat map over
 * HTTP, because what a buyer is shown is the thing under test there.
 */

const stamp = Date.now();
const ids = { events: [] };
let server; let baseUrl;

const row = (over = {}) => ({
  label: 'T1', seatCount: 4, priceCents: 20000, isPrivate: false,
  position: { x: 10, y: 20, rotation: 0 }, shape: 'round', ...over,
});

async function makeEvent(tag, over = {}) {
  const { data, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `seatint-${tag}-${stamp}`, title: `Seating ${tag}`,
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 40 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: ids.terms,
    purchase_mode: 'seat_and_table', ...over,
  }).select('id, slug').single();
  if (error) throw new Error(`seed event ${tag}: ${error.message}`);
  ids.events.push(data.id);
  return data;
}

async function makeTier(eventId, name, priceCents, over = {}) {
  const { data, error } = await supabase.from('ticket_tiers').insert({
    event_id: eventId, name: `${name} ${stamp}`, price_cents: priceCents, ...over,
  }).select('id').single();
  if (error) throw new Error(`seed tier ${name}: ${error.message}`);
  return data.id;
}

/** The map as the editor reads it back, turned into the payload the editor sends. */
async function editorRoundTrip(eventId) {
  const map = await venue.getMapForOrganizer(eventId);
  return {
    map,
    tables: map.tables.map((t) => ({
      id: t.id, label: t.label, seatCount: t.seatCount, priceCents: t.priceCents,
      isPrivate: t.isPrivate, shape: t.shape, categoryId: t.categoryId,
      tierId: t.tierId ?? null, seatPriceCents: t.seatPriceCents ?? null,
      position: t.position,
    })),
  };
}

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text || 'null') };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `seatint-${stamp}@eventsli-test.invalid`, full_name: 'Seating Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Seating Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  ids.terms = terms.id;
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });
});

after(async () => {
  for (const eventId of ids.events) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', eventId);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', eventId);
    await supabase.from('invoices').delete().eq('event_id', eventId);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', eventId);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', eventId);
    const { data: m } = await supabase.from('venue_maps').select('id').eq('event_id', eventId).maybeSingle();
    if (m) {
      await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('tables').delete().eq('venue_map_id', m.id);
    }
    await supabase.from('venue_maps').delete().eq('event_id', eventId);
    await supabase.from('ticket_tiers').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

// ── S-02 ────────────────────────────────────────────────────────────────────

test('S-02: a partly sold table keeps the ticket type the organizer chose, through later saves', async () => {
  const ev = await makeEvent('s02');
  const vip = await makeTier(ev.id, 'VIP', 12000);
  const std = await makeTier(ev.id, 'Standard', 5000);

  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'A', seatCount: 8, tierId: vip })] });
  let { map } = await editorRoundTrip(ev.id);
  const seats = map.tables[0].seats;

  // Seat 1 is mid-checkout as VIP.
  const seat1 = seats.find((s) => s.number === '1');
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: [seat1.id], p_ttl_minutes: 30,
  });
  assert.ok(held.reservation_id, JSON.stringify(held));

  // The organizer moves the table to Standard.
  let trip = await editorRoundTrip(ev.id);
  await venue.saveMap(ev.id, { layout: {}, tables: trip.tables.map((t) => ({ ...t, tierId: std })) });

  // The editor must read Standard back — not whichever seat came first.
  trip = await editorRoundTrip(ev.id);
  assert.equal(trip.map.tables[0].tierId, std, 'the table reports the type the organizer chose');

  // An unrelated save (a move) must not reprice the seats.
  await venue.saveMap(ev.id, {
    layout: {},
    tables: trip.tables.map((t) => ({ ...t, position: { x: 30, y: 30, rotation: 0 } })),
  });
  ({ map } = await editorRoundTrip(ev.id));
  const free = map.tables[0].seats.filter((s) => s.id !== seat1.id);
  assert.ok(free.every((s) => s.tierId === std), 'every available seat is still Standard');
  assert.equal(map.tables[0].seats.find((s) => s.id === seat1.id).tierId, vip,
    'the held seat keeps the type it is being bought as');

  await supabase.rpc('release_reservation', { p_reservation_id: held.reservation_id });
});

// ── S-03 ────────────────────────────────────────────────────────────────────

test('S-03: a save made from a stale copy of the map is refused, and changes nothing', async () => {
  const ev = await makeEvent('s03');
  const tier = await makeTier(ev.id, 'Std', 5000);
  const first = await venue.saveMap(ev.id, {
    layout: {}, tables: [row({ label: 'A', tierId: tier })], expectedVersion: 0,
  });

  // Tab one adds B.
  const tabOne = await editorRoundTrip(ev.id);
  const second = await venue.saveMap(ev.id, {
    layout: {}, tables: [...tabOne.tables, row({ label: 'B', tierId: tier })], expectedVersion: first.version,
  });
  assert.equal(second.version, first.version + 1);

  // Tab two still holds the copy from before B existed. Its save would delete B.
  await assert.rejects(
    () => venue.saveMap(ev.id, { layout: {}, tables: tabOne.tables, expectedVersion: first.version }),
    (err) => err.code === 'MAP_STALE',
  );
  const after_ = await venue.getMapForOrganizer(ev.id);
  assert.deepEqual(after_.tables.map((t) => t.label).sort(), ['A', 'B'], 'B survived');
  assert.equal(after_.version, second.version, 'the refused save did not bump the version');
});

// ── S-14 ────────────────────────────────────────────────────────────────────

test('S-14: two tables can swap names in one save', async () => {
  const ev = await makeEvent('s14');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, {
    layout: {}, tables: [row({ label: 'X', tierId: tier }), row({ label: 'Y', tierId: tier })],
  });
  const { tables } = await editorRoundTrip(ev.id);
  const swapped = tables.map((t) => ({ ...t, label: t.label === 'X' ? 'Y' : 'X' }));
  await venue.saveMap(ev.id, { layout: {}, tables: swapped });

  const map = await venue.getMapForOrganizer(ev.id);
  for (const t of map.tables) {
    assert.ok(t.seats.every((s) => s.section === t.label), `seats of ${t.label} follow its name`);
  }
});

// ── S-08 ────────────────────────────────────────────────────────────────────

test('S-08: seats the organizer blocked do not count as booked', async () => {
  const ev = await makeEvent('s08');
  const a = await makeTier(ev.id, 'A', 5000);
  const b = await makeTier(ev.id, 'B', 7000);
  await venue.saveMap(ev.id, {
    layout: {}, tables: [row({ label: 'Gone', tierId: a }), row({ label: 'Small', tierId: a })],
  });
  const map = await venue.getMapForOrganizer(ev.id);
  const gone = map.tables.find((t) => t.label === 'Gone');
  const small = map.tables.find((t) => t.label === 'Small');

  await venue.setSeatAvailability(ev.id, gone.seats.map((s) => s.id), true);
  const top = small.seats.filter((s) => Number(s.number) > 2).map((s) => s.id);
  await venue.setSeatAvailability(ev.id, top, true);

  // Removing a fully blocked table, shrinking past blocked seats, and moving the
  // blocked seats to another ticket type all succeed.
  const { tables } = await editorRoundTrip(ev.id);
  const keep = tables.filter((t) => t.label === 'Small').map((t) => ({ ...t, tierId: b }));
  await venue.saveMap(ev.id, { layout: {}, tables: keep });
  const smallBack = (await venue.getMapForOrganizer(ev.id)).tables;
  assert.equal(smallBack.length, 1, 'the blocked table was removed');
  assert.equal(smallBack[0].seats.length, 4, 'nothing shrank yet');

  const blockedNow = smallBack[0].seats.filter((s) => s.status === 'blocked');
  assert.ok(blockedNow.every((s) => s.tierId === b), 'a blocked seat moves with its table');

  const trip = await editorRoundTrip(ev.id);
  await venue.saveMap(ev.id, { layout: {}, tables: trip.tables.map((t) => ({ ...t, seatCount: 2 })) });
  const shrunk = (await venue.getMapForOrganizer(ev.id)).tables[0];
  assert.equal(shrunk.seats.length, 2, 'blocked seats can be removed');
});

// ── S-04 ────────────────────────────────────────────────────────────────────

test('S-04: on a live event a save cannot add seats with no price; a whole-table price does not count', async () => {
  const ev = await makeEvent('s04');
  await assert.rejects(
    () => venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'Bare', priceCents: 40000 })] }),
    (err) => err.code === 'VALIDATION_ERROR' && /Bare/.test(err.message),
  );
  assert.equal(await venue.getMapForOrganizer(ev.id), null, 'nothing was written');

  // Selling whole tables only, the table price IS the price.
  const tables = await makeEvent('s04t', { purchase_mode: 'table_only' });
  const ok = await venue.saveMap(tables.id, { layout: {}, tables: [row({ label: 'Bare', priceCents: 40000 })] });
  assert.equal(ok.tables, 1);

  // A draft can be saved unfinished: the submission check catches it later.
  const draft = await makeEvent('s04d', { status: 'draft' });
  const saved = await venue.saveMap(draft.id, { layout: {}, tables: [row({ label: 'Bare' })] });
  assert.equal(saved.tables, 1);
});

// ── S-10 ────────────────────────────────────────────────────────────────────

test('S-10: a cancelled or general-admission event has no map to edit', async () => {
  const cancelled = await makeEvent('s10c', { status: 'cancelled' });
  await assert.rejects(
    () => venue.saveMap(cancelled.id, { layout: {}, tables: [] }),
    (err) => err.code === 'CONFLICT',
  );
  const ga = await makeEvent('s10g', { admission_type: 'general' });
  await assert.rejects(
    () => venue.saveMap(ga.id, { layout: {}, tables: [] }),
    (err) => err.code === 'VALIDATION_ERROR' && /general admission/i.test(err.message),
  );
});

// ── S-05, S-06 ──────────────────────────────────────────────────────────────

test('S-05: a whole table is refused while its ticket type is outside its sale window', async () => {
  const ev = await makeEvent('s05');
  const closed = await makeTier(ev.id, 'Early', 5000, {
    sales_end_at: new Date(Date.now() - 86400e3).toISOString(),
  });
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'E', tierId: closed })] });
  const t = (await venue.getMapForOrganizer(ev.id)).tables[0];

  const { data } = await supabase.rpc('hold_table', {
    p_event_id: ev.id, p_user_id: null, p_table_id: t.id, p_ttl_minutes: 30,
  });
  assert.equal(data.ok, false);
  assert.equal(data.error, 'TIER_NOT_ON_SALE');
});

test('S-05: a whole table is refused once the event is general admission', async () => {
  const ev = await makeEvent('s05g');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'G', tierId: tier })] });
  const t = (await venue.getMapForOrganizer(ev.id)).tables[0];
  await supabase.from('events').update({ admission_type: 'general' }).eq('id', ev.id);

  const { data } = await supabase.rpc('hold_table', {
    p_event_id: ev.id, p_user_id: null, p_table_id: t.id, p_ttl_minutes: 30,
  });
  assert.equal(data.ok, false);
  assert.equal(data.error, 'VALIDATION_ERROR');
});

test('S-06: a ticket type\'s per-order limit applies to chosen seats', async () => {
  const ev = await makeEvent('s06');
  const vip = await makeTier(ev.id, 'VIP', 9000, { max_per_order: 2 });
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'V', tierId: vip })] });
  const seats = (await venue.getMapForOrganizer(ev.id)).tables[0].seats;

  const { data: three } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: seats.slice(0, 3).map((s) => s.id), p_ttl_minutes: 30,
  });
  assert.equal(three.ok, false);
  assert.equal(three.error, 'PURCHASE_LIMIT_EXCEEDED');

  const { data: two } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: seats.slice(0, 2).map((s) => s.id), p_ttl_minutes: 30,
  });
  assert.equal(two.ok, true, JSON.stringify(two));
  await supabase.rpc('release_reservation', { p_reservation_id: two.reservation_id });
});

// ── S-07 ────────────────────────────────────────────────────────────────────

test('S-07: the buyer map marks seats that cannot be bought as unavailable, with a reason', async () => {
  const ev = await makeEvent('s07');
  const later = await makeTier(ev.id, 'Later', 5000, {
    sales_start_at: new Date(Date.now() + 86400e3).toISOString(),
  });
  const one = await makeTier(ev.id, 'One', 5000, { quantity: 1 });
  const fine = await makeTier(ev.id, 'Fine', 5000);
  await venue.saveMap(ev.id, {
    layout: {},
    tables: [
      row({ label: 'L', tierId: later }),
      row({ label: 'O', tierId: one }),
      row({ label: 'F', tierId: fine }),
    ],
  });
  const map = await venue.getMapForOrganizer(ev.id);
  const O = map.tables.find((t) => t.label === 'O');

  // The single allocation of "One" is mid-checkout.
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: [O.seats[0].id], p_ttl_minutes: 30,
  });
  assert.equal(held.ok, true, JSON.stringify(held));

  // And a seat with no price at all, which only an old map can still have.
  const F = map.tables.find((t) => t.label === 'F');
  const bare = F.seats.find((s) => s.number === '4');
  await supabase.from('seats').update({ tier_id: null, price_override_cents: null }).eq('id', bare.id);

  const res = await call('GET', `/public/events/${ev.slug}/seat-map`);
  assert.equal(res.status, 200);
  const byId = new Map(res.body.data.seats.map((s) => [s.id, s]));
  const tableOf = (label) => res.body.data.tables.find((t) => t.label === label);

  const L = map.tables.find((t) => t.label === 'L');
  assert.ok(L.seats.every((s) => byId.get(s.id).available === false && byId.get(s.id).reason === 'not_on_sale'));
  assert.equal(tableOf('L').canBookWhole, false);

  const others = O.seats.slice(1);
  assert.ok(others.every((s) => byId.get(s.id).available === false && byId.get(s.id).reason === 'sold_out'));

  assert.equal(byId.get(bare.id).available, false);
  assert.equal(byId.get(bare.id).reason, 'not_on_sale');
  assert.ok(F.seats.filter((s) => s.id !== bare.id).every((s) => byId.get(s.id).available === true));

  const tierOut = res.body.data.tiers.find((t) => t.id === later);
  assert.equal(tierOut.onSale, false);

  await supabase.rpc('release_reservation', { p_reservation_id: held.reservation_id });
});

// ── S-11 ────────────────────────────────────────────────────────────────────

test('S-11: "from" is the cheapest thing a buyer can actually buy', async () => {
  const ev = await makeEvent('s11');
  // A cheap type no seat uses, and an expensive one the room is priced by.
  await makeTier(ev.id, 'Unused', 1000);
  const real = await makeTier(ev.id, 'Real', 6000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'R', tierId: real, priceCents: null })] });

  const { data, error } = await supabase.rpc('event_from_prices', { p_event_ids: [ev.id] });
  assert.equal(error, null, error?.message);
  assert.equal(Number(data[0].from_cents), 6000);

  // General admission: on-sale, visible, not sold out.
  const ga = await makeEvent('s11g', { admission_type: 'general' });
  await makeTier(ga.id, 'Gone', 500, { quantity: 1, sold_count: 0, sales_end_at: new Date(Date.now() - 1000).toISOString() });
  await makeTier(ga.id, 'Secret', 700, { is_hidden: true });
  await makeTier(ga.id, 'Open', 2500);
  const { data: gaFrom } = await supabase.rpc('event_from_prices', { p_event_ids: [ga.id] });
  assert.equal(Number(gaFrom[0].from_cents), 2500);
});

// ── S-12 ────────────────────────────────────────────────────────────────────

test('S-12: a whole table sold at the door is one receipt line at the table price', async () => {
  const ev = await makeEvent('s12');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'D', tierId: tier, priceCents: 18000 })] });
  const t = (await venue.getMapForOrganizer(ev.id)).tables[0];

  const result = await manual.recordSale({
    eventId: ev.id, tableId: t.id,
    buyer: { name: 'Door Buyer', email: 'door@eventsli-test.invalid' },
    method: 'cash', note: null, recordedBy: ids.profile,
  });
  assert.equal(result.ticket_count, 4, 'every chair still gets its ticket');

  const { data: order } = await supabase.from('orders').select('subtotal_cents').eq('id', result.order_id).single();
  const { data: items } = await supabase.from('order_items').select('table_id, seat_id, unit_price_cents, quantity, label')
    .eq('order_id', result.order_id);
  assert.equal(items.length, 1);
  assert.equal(items[0].table_id, t.id);
  assert.equal(Number(items[0].unit_price_cents), 18000);
  const sum = items.reduce((n, i) => n + Number(i.unit_price_cents) * i.quantity, 0);
  assert.equal(sum, Number(order.subtotal_cents), 'the lines add up to the order');
});

// ═══ Owner decisions, 2026-11-10: S-10, S-16, S-18 ═══════════════════════════

const ticketService = require('../../services/ticketService');
const pricing = require('../../services/pricingService');

const doorSale = (eventId, over) => manual.recordSale({
  eventId, buyer: { name: 'Door Buyer', email: 'door@eventsli-test.invalid' },
  method: 'cash', note: null, recordedBy: ids.profile, ...over,
});

test('S-18: a price change mid-hold and after a sale leaves both at the price they were taken at', async () => {
  const ev = await makeEvent('s18');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'P', tierId: tier })] });
  const seats = (await venue.getMapForOrganizer(ev.id)).tables[0].seats;

  // One seat sold at $50, one held at $50.
  const sold = await doorSale(ev.id, { seatIds: [seats[0].id] });
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: [seats[1].id], p_ttl_minutes: 30,
  });
  assert.equal(held.ok, true, JSON.stringify(held));

  // The type goes to $80 — allowed after a sale, on a live event.
  const { error } = await supabase.rpc('set_tier_price', {
    p_tier_id: tier, p_event_id: ev.id, p_price_cents: 8000, p_actor: ids.profile,
  });
  assert.equal(error, null, error?.message);

  const { data: lines } = await supabase.from('order_items').select('unit_price_cents').eq('order_id', sold.order_id);
  assert.deepEqual(lines.map((l) => Number(l.unit_price_cents)), [5000], 'the sold ticket keeps $50');
  const quote = await pricing.quoteReservation(held.reservation_id);
  assert.equal(quote.breakdown.subtotalCents, 5000, 'the hold is charged what it was taken at');

  const next = await doorSale(ev.id, { seatIds: [seats[2].id] });
  const { data: newLines } = await supabase.from('order_items').select('unit_price_cents').eq('order_id', next.order_id);
  assert.deepEqual(newLines.map((l) => Number(l.unit_price_cents)), [8000], 'a new sale is at the new price');

  await supabase.rpc('release_reservation', { p_reservation_id: held.reservation_id });
  await supabase.from('admin_audit').delete().eq('action', 'price.change').eq('target_id', tier);
});

test('S-10: every price change on a live event is logged with who made it, and needs no review', async () => {
  const ev = await makeEvent('s10live');
  const a = await makeTier(ev.id, 'A', 5000);
  const b = await makeTier(ev.id, 'B', 9000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'L', tierId: a, priceCents: 18000 })] },
    { actorId: ids.profile });
  const trip = await editorRoundTrip(ev.id);
  const tableId = trip.tables[0].id;

  await venue.saveMap(ev.id, {
    layout: {}, tables: trip.tables.map((t) => ({ ...t, priceCents: 20000, seatPriceCents: 5500, tierId: b })),
  }, { actorId: ids.profile });

  const { data: event } = await supabase.from('events').select('status').eq('id', ev.id).single();
  assert.equal(event.status, 'published', 'still on sale: no review step');

  const { data: rows } = await supabase.from('admin_audit')
    .select('actor_id, payload').eq('action', 'price.change').eq('target_id', tableId);
  const byField = Object.fromEntries(rows.map((r) => [r.payload.field, r]));
  assert.deepEqual(Object.keys(byField).sort(), ['price', 'seatPrice', 'ticketType']);
  assert.ok(rows.every((r) => r.actor_id === ids.profile && r.payload.eventStatus === 'published'));
  assert.equal(Number(byField.price.payload.oldCents), 18000);
  assert.equal(Number(byField.price.payload.newCents), 20000);
  assert.equal(byField.ticketType.payload.oldTierId, a);
  assert.equal(byField.ticketType.payload.newTierId, b);

  // A save that changes no price logs nothing.
  const again = await editorRoundTrip(ev.id);
  await venue.saveMap(ev.id, {
    layout: {}, tables: again.tables.map((t) => ({ ...t, position: { x: 50, y: 50, rotation: 0 } })),
  }, { actorId: ids.profile });
  const { count } = await supabase.from('admin_audit').select('id', { count: 'exact', head: true })
    .eq('action', 'price.change').eq('target_id', tableId);
  assert.equal(count, 3);
  await supabase.from('admin_audit').delete().eq('action', 'price.change').eq('target_id', tableId);
});

test('S-16: an issued ticket keeps the table name it was issued with; a new one takes the new name', async () => {
  const ev = await makeEvent('s16');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'Rose', tierId: tier })] });
  const seats = (await venue.getMapForOrganizer(ev.id)).tables[0].seats;
  const first = await doorSale(ev.id, { seatIds: [seats[0].id] });

  const trip = await editorRoundTrip(ev.id);
  await venue.saveMap(ev.id, { layout: {}, tables: trip.tables.map((t) => ({ ...t, label: 'Lily' })) });
  const second = await doorSale(ev.id, { seatIds: [seats[1].id] });

  const [oldTicket] = await ticketService.forOrder(first.order_id);
  const [newTicket] = await ticketService.forOrder(second.order_id);
  assert.equal(oldTicket.table, 'Rose', 'issued before the rename');
  assert.equal(oldTicket.seat.section, 'Rose');
  assert.equal(newTicket.table, 'Lily', 'issued after it');

  // The door reads the same snapshot.
  const { data: detail, error: detailError } = await supabase.rpc('ticket_door_detail', {
    p_event_id: ev.id, p_ticket_id: oldTicket.id,
  });
  assert.equal(detailError, null, detailError?.message);
  assert.equal(detail.table, 'Rose');

  // And it cannot be rewritten.
  const { error } = await supabase.from('tickets').update({ issued_table_label: 'Lily' }).eq('id', oldTicket.id);
  assert.match(error?.message || '', /TICKET_PLACE_IMMUTABLE/);
});

// ═══ Theatre rows (S-19) and blocking saved with the map ═══════════════════════

test('S-19: a section row is addressed Section, Row, Seat everywhere a ticket is read', async () => {
  const ev = await makeEvent('s19');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, {
    layout: {},
    tables: [
      row({ label: 'Gold C', shape: 'row', tierId: tier, section: 'Gold', row: 'C' }),
      row({ label: 'Gold D', shape: 'row', tierId: tier, section: 'Gold', row: 'D' }),
    ],
  });
  const map = await venue.getMapForOrganizer(ev.id);
  const c = map.tables.find((t) => t.label === 'Gold C');
  assert.equal(c.section, 'Gold');
  assert.equal(c.row, 'C');
  assert.ok(c.seats.every((s) => s.section === 'Gold' && s.row === 'C'));

  const sale = await doorSale(ev.id, { seatIds: [c.seats.find((s) => s.number === '4').id] });
  const [ticket] = await ticketService.forOrder(sale.order_id);
  assert.equal(ticket.table, null, 'a row of a section is not a table booking');
  assert.deepEqual(ticket.seat, { section: 'Gold', row: 'C', number: '4' });

  // Two rows that would share seats are refused by name, and nothing lands.
  const trip = await editorRoundTrip(ev.id);
  await assert.rejects(
    () => venue.saveMap(ev.id, {
      layout: {},
      tables: trip.tables.map((t) => ({ ...t, section: 'Gold', row: 'C' })),
    }),
    (err) => err.code === 'VALIDATION_ERROR' && /Gold C and Gold D/.test(err.message),
  );
});

test('blocking and releasing seats is saved with the map, in the same transaction', async () => {
  const ev = await makeEvent('avail');
  const tier = await makeTier(ev.id, 'Std', 5000);
  await venue.saveMap(ev.id, { layout: {}, tables: [row({ label: 'K', tierId: tier })] });
  const trip = await editorRoundTrip(ev.id);
  const seats = trip.map.tables[0].seats;

  // A buyer holds seat 4 while the organizer is choosing what to block.
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ev.id, p_user_id: null, p_seat_ids: [seats[3].id], p_ttl_minutes: 30,
  });
  const res = await venue.saveMap(ev.id, {
    layout: {}, tables: trip.tables, expectedVersion: trip.map.version,
    availability: { block: [seats[0].id, seats[1].id, seats[3].id], release: [] },
  });
  assert.deepEqual(res.availability, { blocked: 2, released: 0, requested: 3 }, 'the held seat is never taken back');

  const now = (await venue.getMapForOrganizer(ev.id)).tables[0].seats;
  const status = Object.fromEntries(now.map((s) => [s.id, s.status]));
  assert.equal(status[seats[0].id], 'blocked');
  assert.equal(status[seats[3].id], 'held');

  // A refused save changes no seat's availability either.
  await assert.rejects(() => venue.saveMap(ev.id, {
    layout: {}, tables: trip.tables, expectedVersion: trip.map.version,
    availability: { block: [seats[2].id], release: [seats[0].id] },
  }), (err) => err.code === 'MAP_STALE');
  const after_ = Object.fromEntries((await venue.getMapForOrganizer(ev.id)).tables[0].seats.map((s) => [s.id, s.status]));
  assert.equal(after_[seats[2].id], 'available', 'the refused block did not land');
  assert.equal(after_[seats[0].id], 'blocked', 'the refused release did not land');

  // Released with the next good save.
  const ok = await venue.saveMap(ev.id, { layout: {}, tables: trip.tables, availability: { block: [], release: [seats[0].id] } });
  assert.equal(ok.availability.released, 1);

  await supabase.rpc('release_reservation', { p_reservation_id: held.reservation_id });
});
