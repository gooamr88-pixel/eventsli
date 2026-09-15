const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const venue = require('../../services/venueService');
const { verifyTablePassword } = require('../../services/tableAccessService');

/**
 * Saving the map.
 *
 * This is the one place where an organizer's edit can destroy stock somebody
 * has already paid for. It used to run as a loop of separate statements from
 * Node — one transaction per table — so a failure halfway left the map half
 * saved, with no way to tell which half and no way back. It is now
 * `save_venue_map`, one transaction, and these tests are what say so.
 *
 * The properties under test:
 *   • held or sold stock is never removed or shrunk;
 *   • a refusal changes NOTHING — not the tables it had already reached, not
 *     the layout that rode along in the same payload, not the version;
 *   • a password survives a save that does not mention it.
 */

const stamp = Date.now();
const ids = {};

const table = (over = {}) => ({
  label: 'T1', seatCount: 4, priceCents: 20000, isPrivate: false,
  position: { x: 10, y: 20, rotation: 0 }, shape: 'round', ...over,
});

before(async () => {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `vmap-${stamp}@eventsli-test.invalid`, full_name: 'Map Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Map Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `vmap-${stamp}`, title: 'Venue Map Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 40 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;
});

after(async () => {
  if (ids.event) {
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    const { data: m } = await supabase.from('venue_maps')
      .select('id').eq('event_id', ids.event).maybeSingle();
    if (m) {
      await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('tables').delete().eq('venue_map_id', m.id);
    }
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
});

// ── Creating ────────────────────────────────────────────────────────────────

test('a new map generates a seat per chair the organizer drew', async () => {
  const res = await venue.saveMap(ids.event, {
    layout: { width: 800 },
    tables: [table({ label: 'A', seatCount: 4 }), table({ label: 'B', seatCount: 6 })],
  });

  assert.equal(res.tables, 2);
  ids.map = res.mapId;

  const map = await venue.getMapForOrganizer(ids.event);
  assert.equal(map.layout.width, 800);
  const a = map.tables.find((t) => t.label === 'A');
  const b = map.tables.find((t) => t.label === 'B');
  assert.equal(a.seats.length, 4, 'seats are the sellable stock, not a number on a table row');
  assert.equal(b.seats.length, 6);
  assert.deepEqual(a.seats.map((s) => s.number).sort(), ['1', '2', '3', '4']);
  ids.tableA = a.id;
  ids.tableB = b.id;
});

test('a table dropped from the payload is deleted with its seats', async () => {
  const res = await venue.saveMap(ids.event, {
    layout: { width: 800 },
    tables: [table({ id: ids.tableA, label: 'A', seatCount: 4 })],
  });
  assert.equal(res.tables, 1);

  const { data: orphans } = await supabase.from('seats').select('id').eq('table_id', ids.tableB);
  assert.equal(orphans.length, 0, 'seats must not outlive their table');
});

test('growing a table adds seats without disturbing the ones already there', async () => {
  const start = await venue.getMapForOrganizer(ids.event);
  const keep = start.tables[0].seats.map((s) => s.id);

  await venue.saveMap(ids.event, {
    layout: {}, tables: [table({ id: ids.tableA, label: 'A', seatCount: 7 })],
  });

  const map = await venue.getMapForOrganizer(ids.event);
  assert.equal(map.tables[0].seats.length, 7);
  const now = map.tables[0].seats.map((s) => s.id);
  for (const id of keep) {
    assert.ok(now.includes(id), 'an existing seat id must survive — tickets point at it');
  }
});

// ── Refusing ────────────────────────────────────────────────────────────────

test('a held seat cannot be shrunk away, and nothing else in the payload lands', async () => {
  const start = await venue.getMapForOrganizer(ids.event);
  const seat7 = start.tables[0].seats.find((s) => s.number === '7');

  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [seat7.id], p_ttl_minutes: 30,
  });
  assert.ok(held.reservation_id, 'the hold itself must succeed');

  await assert.rejects(
    () => venue.saveMap(ids.event, {
      layout: { width: 9999 },
      tables: [table({ id: ids.tableA, label: 'RENAMED', seatCount: 4 })],
    }),
    (err) => err.code === 'CONFLICT' && /booked/i.test(err.message),
  );

  // The refusal is the whole point of the single transaction: the rename and
  // the layout change rode along in the same payload, and neither may land.
  const map = await venue.getMapForOrganizer(ids.event);
  assert.equal(map.tables[0].seats.length, 7, 'no seat was removed');
  assert.equal(map.tables[0].label, 'A', 'and the rename did not sneak through');
  assert.notEqual(map.layout.width, 9999, 'nor the layout it was bundled with');
  assert.equal(map.version, start.version, 'the version stands still on a refusal');

  await supabase.rpc('release_reservation', { p_reservation_id: held.reservation_id });
});

test('a booked table cannot be deleted, and every blocked table is named at once', async () => {
  // Named at once, rather than failing on the first: otherwise the organizer
  // discovers them one save at a time.
  await venue.saveMap(ids.event, {
    layout: {},
    tables: [
      table({ id: ids.tableA, label: 'A', seatCount: 7 }),
      table({ label: 'C', seatCount: 2 }),
      table({ label: 'D', seatCount: 2 }),
    ],
  });
  const map = await venue.getMapForOrganizer(ids.event);
  const blocked = ['C', 'D'].map((l) => map.tables.find((t) => t.label === l));

  const holds = [];
  for (const t of blocked) {
    const { data: h } = await supabase.rpc('hold_table', {
      p_event_id: ids.event, p_user_id: null, p_table_id: t.id, p_ttl_minutes: 30,
    });
    assert.ok(h.reservation_id, `hold on ${t.label}: ${JSON.stringify(h)}`);
    holds.push(h.reservation_id);
  }

  await assert.rejects(
    () => venue.saveMap(ids.event, {
      layout: {}, tables: [table({ id: ids.tableA, label: 'A', seatCount: 7 })],
    }),
    (err) => err.code === 'CONFLICT' && /\bC\b/.test(err.message) && /\bD\b/.test(err.message),
  );

  for (const r of holds) await supabase.rpc('release_reservation', { p_reservation_id: r });
  await venue.saveMap(ids.event, {
    layout: {}, tables: [table({ id: ids.tableA, label: 'A', seatCount: 7 })],
  });
});

test('a duplicate label is refused before the database is touched', async () => {
  await assert.rejects(
    () => venue.saveMap(ids.event, {
      layout: {}, tables: [table({ label: 'Same' }), table({ label: 'same' })],
    }),
    (err) => err.code === 'VALIDATION_ERROR' && /unique/i.test(err.message),
  );

  const map = await venue.getMapForOrganizer(ids.event);
  assert.equal(map.tables.length, 1, 'the first of the pair must not have been written');
});

// ── Passwords ───────────────────────────────────────────────────────────────

test('a private table keeps its password through a save that does not mention it', async () => {
  await venue.saveMap(ids.event, {
    layout: {},
    tables: [
      table({ id: ids.tableA, label: 'A', seatCount: 7 }),
      table({ label: 'VIP', seatCount: 8, isPrivate: true, password: 'the-back-room' }),
    ],
  });

  const map = await venue.getMapForOrganizer(ids.event);
  const vip = map.tables.find((t) => t.label === 'VIP');
  assert.equal(vip.hasPassword, true);

  // The editor sends its state back with no password field — the ordinary case
  // of dragging a table across the room. That must not quietly unprotect it.
  await venue.saveMap(ids.event, {
    layout: {},
    tables: [
      table({ id: ids.tableA, label: 'A', seatCount: 7 }),
      table({
        id: vip.id, label: 'VIP', seatCount: 8, isPrivate: true,
        position: { x: 300, y: 40, rotation: 90 },
      }),
    ],
  });

  const { data: row } = await supabase.from('tables')
    .select('password_hash, position_x').eq('id', vip.id).single();
  assert.ok(row.password_hash, 'the hash must still be there');
  assert.equal(
    await verifyTablePassword(vip.id, 'the-back-room'), true,
    'and still be the same password',
  );
  assert.equal(Number(row.position_x), 300, 'while the move itself did land');
});

test('turning a table public clears the password', async () => {
  const map = await venue.getMapForOrganizer(ids.event);
  const vip = map.tables.find((t) => t.label === 'VIP');

  await venue.saveMap(ids.event, {
    layout: {},
    tables: [
      table({ id: ids.tableA, label: 'A', seatCount: 7 }),
      table({ id: vip.id, label: 'VIP', seatCount: 8, isPrivate: false }),
    ],
  });

  const { data: row } = await supabase.from('tables')
    .select('password_hash, is_private').eq('id', vip.id).single();
  assert.equal(row.is_private, false);
  assert.equal(row.password_hash, null, 'a public table holding a live hash is a trap');
});

test('no password material reaches the organizer payload', async () => {
  const map = JSON.stringify(await venue.getMapForOrganizer(ids.event));
  assert.equal(map.includes('password_hash'), false);
  assert.equal(map.includes('the-back-room'), false);
});

// ── Another event's stock ───────────────────────────────────────────────────
//
// Table ids are public — every published seat map carries them — so an id in
// a save is attacker-controlled. `save_venue_map` used to look a table up by id
// alone and rewrite it: price, password, seat count. These pin the fix.

async function seedOtherEvent(tag) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `vmap-other-${tag}-${stamp}`, title: 'Someone Else',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 45 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 45 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
  }).select('id').single();
  if (error) throw new Error(`seed other event: ${error.message}`);

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  const { data: tbl } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'Theirs', seat_count: 4, price_cents: 50000,
    is_private: true, password_hash: 'not-a-real-hash',
  }).select('id').single();
  await supabase.from('seats').insert(Array.from({ length: 4 }, (_, i) => ({
    venue_map_id: map.id, table_id: tbl.id, section_key: 'Theirs', row_label: 'A',
    seat_number: String(i + 1),
  })));
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'Their tier', price_cents: 9000 }).select('id').single();

  return { event: ev.id, map: map.id, table: tbl.id, tier: tier.id };
}

async function dropOtherEvent(o) {
  await supabase.from('seats').delete().eq('venue_map_id', o.map);
  await supabase.from('tables').delete().eq('venue_map_id', o.map);
  await supabase.from('venue_maps').delete().eq('id', o.map);
  await supabase.from('ticket_tiers').delete().eq('event_id', o.event);
  await supabase.from('events').delete().eq('id', o.event);
}

test('a table from another event cannot be rewritten through this map', async () => {
  const other = await seedOtherEvent('table');
  try {
    const before_ = await venue.getMapForOrganizer(ids.event);

    await assert.rejects(
      () => venue.saveMap(ids.event, {
        layout: {},
        tables: [table({ id: other.table, label: 'Stolen', seatCount: 1, priceCents: 0, isPrivate: false })],
      }),
      (err) => err.code === 'CONFLICT' && /not on this map/i.test(err.message),
    );

    const { data: theirs } = await supabase.from('tables')
      .select('label, price_cents, is_private, password_hash, seat_count').eq('id', other.table).single();
    assert.equal(theirs.label, 'Theirs');
    assert.equal(Number(theirs.price_cents), 50000, 'their price is untouched');
    assert.equal(theirs.is_private, true, 'their private table is still private');
    assert.equal(theirs.password_hash, 'not-a-real-hash', 'and keeps its password');
    assert.equal(theirs.seat_count, 4);

    const { count } = await supabase.from('seats')
      .select('id', { count: 'exact', head: true }).eq('table_id', other.table);
    assert.equal(count, 4, 'none of their seats were deleted');

    const after_ = await venue.getMapForOrganizer(ids.event);
    assert.equal(after_.tables.length, before_.tables.length,
      'and this map was not emptied by the refused save');
  } finally {
    await dropOtherEvent(other);
  }
});

test('a ticket type from another event cannot be attached to this map', async () => {
  const other = await seedOtherEvent('tier');
  try {
    const before_ = await venue.getMapForOrganizer(ids.event);

    await assert.rejects(
      () => venue.saveMap(ids.event, {
        layout: {}, tables: [table({ label: 'Borrowed', seatCount: 2, tierId: other.tier })],
      }),
      (err) => err.code === 'VALIDATION_ERROR' && /different event/i.test(err.message),
    );

    const { count } = await supabase.from('seats')
      .select('id', { count: 'exact', head: true }).eq('tier_id', other.tier);
    assert.equal(count, 0, 'no seat was pointed at their tier');

    const after_ = await venue.getMapForOrganizer(ids.event);
    assert.equal(after_.tables.length, before_.tables.length);
  } finally {
    await dropOtherEvent(other);
  }
});

test('a malformed id is refused before the database is asked', async () => {
  await assert.rejects(
    () => venue.saveMap(ids.event, { layout: {}, tables: [table({ id: 'not-a-uuid' })] }),
    (err) => err.code === 'VALIDATION_ERROR' && /invalid id/i.test(err.message),
  );
});
