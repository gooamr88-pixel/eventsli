const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The only test that can prove the seat engine is correct.
 *
 * Every call below goes over its own HTTP request to PostgREST, so these are
 * genuinely parallel transactions against the real database — not promises
 * interleaved on one connection, which would prove nothing about locking.
 *
 * The property under test is always the same: N buyers race for one piece of
 * stock, and EXACTLY ONE wins. Not "usually one". A test that asserts
 * `successes >= 1` passes on a system that double-sells.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const stamp = Date.now();
const ids = { profile: null, organizer: null, event: null, map: null, tier: null };
let tableId;
let seatIds = [];

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `seat-${stamp}@eventsli-test.invalid`,
    full_name: 'Seat Test',
    role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Seat Test Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  // published_requires_terms refuses a published event with no recorded terms
  // acceptance — it caught this seed taking a shortcut, which is exactly what a
  // constraint is for. The test has to go through the real gate too.
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances')
    .insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error: evErr } = await supabase.from('events').insert({
    organizer_id: org.id,
    slug: `seat-test-${stamp}`,
    title: 'Seat Concurrency Test',
    country: 'CA',
    timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD',
    // Published so the RPC's on-sale check passes. Both purchase routes open,
    // which is the configuration where table and seat buyers can collide.
    status: 'published',
    terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
    max_tickets_per_order: 10,
  }).select('id').single();
  // Surfaced rather than swallowed: a silent seed failure shows up later as
  // "Cannot read properties of null", which says nothing about the real cause.
  if (evErr) throw new Error(`seed failed: ${evErr.message}`);
  ids.event = ev.id;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;

  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'Standard', price_cents: 5000 })
    .select('id').single();
  ids.tier = tier.id;
}

/** A fresh table with `seats` free seats. Each test gets its own. */
async function makeTable(label, seatCount = 10, priceCents = 45000) {
  const { data: t, error: tErr } = await supabase.from('tables').insert({
    venue_map_id: ids.map,
    label,
    seat_count: seatCount,
    price_cents: priceCents,   // BRD §25 — independent of 10 × $50
  }).select('id').single();
  if (tErr) throw new Error(`makeTable(${label}) table insert: ${tErr.message}`);

  const rows = Array.from({ length: seatCount }, (_, i) => ({
    venue_map_id: ids.map,
    table_id: t.id,
    tier_id: ids.tier,
    section_key: label,
    row_label: 'A',
    seat_number: String(i + 1),
  }));
  const { data: s, error: sErr } = await supabase.from('seats').insert(rows).select('id');
  if (sErr) throw new Error(`makeTable(${label}) seats insert: ${sErr.message}`);
  return { tableId: t.id, seatIds: s.map((r) => r.id) };
}

before(async () => {
  await seed();
  const made = await makeTable('T1');
  tableId = made.tableId;
  seatIds = made.seatIds;
});

after(async () => {
  if (ids.event) {
    await supabase.from('reservation_items').delete()
      .in('reservation_id',
        (await supabase.from('reservations').select('id').eq('event_id', ids.event)).data?.map((r) => r.id) || ['00000000-0000-0000-0000-000000000000']);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('tables').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) await supabase.from('profiles').delete().eq('id', ids.profile);
});

const holdSeats = (seats) => supabase.rpc('hold_seats', {
  p_event_id: ids.event, p_user_id: null, p_seat_ids: seats, p_ttl_minutes: 35,
});
const holdTable = (id) => supabase.rpc('hold_table', {
  p_event_id: ids.event, p_user_id: null, p_table_id: id, p_ttl_minutes: 35,
});
const release = (rid) => supabase.rpc('release_reservation', { p_reservation_id: rid });

const wins = (results) => results.filter((r) => r.data?.ok === true);
const losses = (results) => results.filter((r) => r.data?.ok === false);

// ── The core property ───────────────────────────────────────────────────────

test('20 buyers race for one seat — exactly one wins', async () => {
  const seat = seatIds[0];
  const results = await Promise.all(
    Array.from({ length: 20 }, () => holdSeats([seat])),
  );

  const won = wins(results);
  assert.equal(won.length, 1, `expected exactly 1 winner, got ${won.length}`);
  assert.equal(losses(results).length, 19);
  assert.equal(losses(results)[0].data.error, 'SEAT_UNAVAILABLE');

  await release(won[0].data.reservation_id);
});

test('10 buyers race for one whole table — exactly one wins', async () => {
  const { tableId: tid } = await makeTable('T-race', 8);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => holdTable(tid)),
  );

  const won = wins(results);
  assert.equal(won.length, 1, `expected exactly 1 winner, got ${won.length}`);
  // Losers must be told the table went, not that the request was malformed.
  for (const l of losses(results)) {
    assert.ok(['TABLE_UNAVAILABLE', 'TABLE_PARTIALLY_SOLD'].includes(l.data.error), l.data.error);
  }

  await release(won[0].data.reservation_id);
});

/**
 * The collision the whole lock order exists for: one buyer takes the table, the
 * other takes a seat inside it, at the same instant, arriving by different code
 * paths. Repeated, because a race that only sometimes collides only sometimes
 * proves anything.
 */
test('a table buyer and a seat buyer collide — exactly one wins, every time', async () => {
  for (let round = 0; round < 12; round += 1) {
    const { tableId: tid, seatIds: sids } = await makeTable(`T-collide-${round}`, 6);

    const [tableRes, seatRes] = await Promise.all([
      holdTable(tid),
      holdSeats([sids[2]]),
    ]);

    const won = [tableRes, seatRes].filter((r) => r.data?.ok === true);
    assert.equal(
      won.length, 1,
      `round ${round}: table=${tableRes.data?.ok} seat=${seatRes.data?.ok} — both cannot succeed`,
    );

    await release(won[0].data.reservation_id);
  }
});

// ── BRD §25 — the rules the race protects ───────────────────────────────────

test('one seat sold individually closes the whole-table option for good', async () => {
  const { tableId: tid, seatIds: sids } = await makeTable('T-partial', 6);

  const seat = await holdSeats([sids[0]]);
  assert.equal(seat.data.ok, true);

  // The trigger derives table status from its seats, so this needs no separate write.
  const { data: t } = await supabase.from('tables').select('status').eq('id', tid).single();
  assert.equal(t.status, 'partial');

  const whole = await holdTable(tid);
  assert.equal(whole.data.ok, false);
  assert.equal(whole.data.error, 'TABLE_PARTIALLY_SOLD');

  // The remaining seats stay individually sellable.
  const rest = await holdSeats([sids[1], sids[2]]);
  assert.equal(rest.data.ok, true);

  await release(seat.data.reservation_id);
  await release(rest.data.reservation_id);
});

test('holding a table takes every seat with it', async () => {
  const { tableId: tid, seatIds: sids } = await makeTable('T-whole', 5);

  const res = await holdTable(tid);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.seat_count, 5);
  // The table's own price, not 5 × the seat price.
  assert.equal(res.data.subtotal_cents, 45000);

  const { data: seats } = await supabase.from('seats').select('status').in('id', sids);
  assert.ok(seats.every((s) => s.status === 'held'), 'no seat may be left sellable');

  const single = await holdSeats([sids[0]]);
  assert.equal(single.data.ok, false);
  assert.equal(single.data.error, 'SEAT_UNAVAILABLE');

  await release(res.data.reservation_id);
});

test('a released table and its seats go back on sale together', async () => {
  const { tableId: tid, seatIds: sids } = await makeTable('T-release', 4);

  const held = await holdTable(tid);
  await release(held.data.reservation_id);

  const { data: t } = await supabase.from('tables').select('status').eq('id', tid).single();
  assert.equal(t.status, 'available');

  const { data: seats } = await supabase.from('seats').select('status').in('id', sids);
  assert.ok(seats.every((s) => s.status === 'available'));

  const again = await holdTable(tid);
  assert.equal(again.data.ok, true, 'it must be bookable again');
  await release(again.data.reservation_id);
});

// ── All-or-nothing, and the limits ──────────────────────────────────────────

test('a partly-taken seat selection fails whole', async () => {
  const { seatIds: sids } = await makeTable('T-allornothing', 6);

  const first = await holdSeats([sids[0]]);
  assert.equal(first.data.ok, true);

  const overlapping = await holdSeats([sids[0], sids[1], sids[2]]);
  assert.equal(overlapping.data.ok, false);
  assert.equal(overlapping.data.error, 'SEAT_UNAVAILABLE');

  // The two that WERE free must not have been quietly taken.
  const { data: seats } = await supabase
    .from('seats').select('status').in('id', [sids[1], sids[2]]);
  assert.ok(seats.every((s) => s.status === 'available'), 'a failed hold must leave nothing held');

  await release(first.data.reservation_id);
});

test('the per-order limit is enforced in the database', async () => {
  const { seatIds: sids } = await makeTable('T-limit', 12);
  const res = await holdSeats(sids.slice(0, 11));   // the event allows 10
  assert.equal(res.data.ok, false);
  assert.equal(res.data.error, 'PURCHASE_LIMIT_EXCEEDED');
});

test('purchase mode is enforced', async () => {
  const { tableId: tid, seatIds: sids } = await makeTable('T-mode', 4);

  await supabase.from('events').update({ purchase_mode: 'table_only' }).eq('id', ids.event);
  const seatAttempt = await holdSeats([sids[0]]);
  assert.equal(seatAttempt.data.ok, false);
  assert.match(seatAttempt.data.message, /whole tables only/i);

  await supabase.from('events').update({ purchase_mode: 'seat_only' }).eq('id', ids.event);
  const tableAttempt = await holdTable(tid);
  assert.equal(tableAttempt.data.ok, false);
  assert.match(tableAttempt.data.message, /individual seats only/i);

  await supabase.from('events').update({ purchase_mode: 'seat_and_table' }).eq('id', ids.event);
});

test('an unpublished event sells nothing', async () => {
  const { seatIds: sids } = await makeTable('T-draft', 3);
  await supabase.from('events').update({ status: 'suspended' }).eq('id', ids.event);

  const res = await holdSeats([sids[0]]);
  assert.equal(res.data.ok, false);
  assert.equal(res.data.error, 'EVENT_NOT_PUBLISHED');

  await supabase.from('events').update({ status: 'published' }).eq('id', ids.event);
});

test('a table with no price cannot be sold whole', async () => {
  const { data: t } = await supabase.from('tables').insert({
    venue_map_id: ids.map, label: 'T-nopricing', seat_count: 2, price_cents: null,
  }).select('id').single();
  await supabase.from('seats').insert([
    { venue_map_id: ids.map, table_id: t.id, tier_id: ids.tier, section_key: 'T-nopricing', row_label: 'A', seat_number: '1' },
    { venue_map_id: ids.map, table_id: t.id, tier_id: ids.tier, section_key: 'T-nopricing', row_label: 'A', seat_number: '2' },
  ]);

  const res = await holdTable(t.id);
  assert.equal(res.data.ok, false);
  // Refused, rather than charging zero — the failure nobody notices until payout.
  assert.match(res.data.message, /no price/i);
});

test('a paid reservation cannot be released back onto sale', async () => {
  const { seatIds: sids } = await makeTable('T-converted', 3);
  const held = await holdSeats([sids[0]]);
  await supabase.from('reservations')
    .update({ state: 'converted' }).eq('id', held.data.reservation_id);

  const res = await release(held.data.reservation_id);
  assert.equal(res.data.ok, false);
  assert.equal(res.data.error, 'CONFLICT');

  const { data: seat } = await supabase.from('seats').select('status').eq('id', sids[0]).single();
  assert.equal(seat.status, 'held', 'sold stock must not go back on sale');
});
