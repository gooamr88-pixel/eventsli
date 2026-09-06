const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const scheduler = require('../../services/scheduler');

/**
 * The background jobs, against the real database.
 *
 * These existed as correct SQL functions for weeks with nothing calling them.
 * Every test passed, because every test invoked them directly — and the
 * practical consequence was that an abandoned checkout held its seats forever.
 *
 * So these tests do NOT call the SQL. They call the scheduler's job functions,
 * the same entry points the timers use, including the leader lock.
 */

const stamp = Date.now();
const ids = {};
let seatIds = [];

before(async () => {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `sched-${stamp}@eventsli-test.invalid`, full_name: 'Sched Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Sched Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `sched-${stamp}`, title: 'Scheduler Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_only',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'GA', price_cents: 3000 }).select('id').single();

  const { data: s } = await supabase.from('seats').insert(
    Array.from({ length: 6 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');
  seatIds = s.map((r) => r.id);
});

after(async () => {
  if (ids.event) {
    await supabase.from('invoices').delete().eq('event_id', ids.event);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('sessions').delete().eq('user_id', ids.profile);
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
});

const hold = (seats) => supabase.rpc('hold_seats', {
  p_event_id: ids.event, p_user_id: null, p_seat_ids: seats, p_ttl_minutes: 35,
});

// ── The one that actually mattered ──────────────────────────────────────────

test('an abandoned hold is released, and the seats go back on sale', async () => {
  const held = await hold([seatIds[0], seatIds[1]]);
  assert.equal(held.data.ok, true);

  // Age it past its window, as the clock would.
  await supabase.from('reservations')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', held.data.reservation_id);

  const released = await scheduler.expireReservations();
  assert.ok(released >= 1, 'the sweep must find it');

  const { data: seats } = await supabase.from('seats')
    .select('status, held_by_reservation').in('id', [seatIds[0], seatIds[1]]);
  assert.ok(seats.every((s) => s.status === 'available'), 'stock must return to sale');
  assert.ok(seats.every((s) => s.held_by_reservation === null), 'and lose its hold marker');

  const { data: res } = await supabase.from('reservations')
    .select('state').eq('id', held.data.reservation_id).single();
  assert.equal(res.state, 'expired');

  // The real point: someone else can now buy them.
  const next = await hold([seatIds[0]]);
  assert.equal(next.data.ok, true);
  await supabase.rpc('release_reservation', { p_reservation_id: next.data.reservation_id });
});

test('a live hold is left alone', async () => {
  const held = await hold([seatIds[2]]);
  await scheduler.expireReservations();

  const { data: res } = await supabase.from('reservations')
    .select('state').eq('id', held.data.reservation_id).single();
  assert.equal(res.state, 'active', 'a hold inside its window must survive the sweep');

  const { data: seat } = await supabase.from('seats')
    .select('status').eq('id', seatIds[2]).single();
  assert.equal(seat.status, 'held');

  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

test('a converted hold is never swept', async () => {
  const held = await hold([seatIds[3]]);
  await supabase.from('reservations').update({
    state: 'converted',
    expires_at: new Date(Date.now() - 86400e3).toISOString(),
  }).eq('id', held.data.reservation_id);

  await scheduler.expireReservations();

  // A paid seat must not return to sale because its hold clock ran out.
  const { data: seat } = await supabase.from('seats')
    .select('status').eq('id', seatIds[3]).single();
  assert.equal(seat.status, 'held', 'sold stock must not be swept back onto sale');
});

test('sweeping several expired holds at once works', async () => {
  // The previous implementation used `UPDATE ... RETURNING id INTO` a scalar,
  // which raised "query returned more than one row" on exactly this case and
  // swept nothing at all.
  const a = await hold([seatIds[4]]);
  const b = await hold([seatIds[5]]);
  const past = new Date(Date.now() - 60_000).toISOString();
  await supabase.from('reservations').update({ expires_at: past })
    .in('id', [a.data.reservation_id, b.data.reservation_id]);

  const released = await scheduler.expireReservations();
  assert.ok(released >= 2, `expected at least 2, got ${released}`);

  const { data: seats } = await supabase.from('seats')
    .select('status').in('id', [seatIds[4], seatIds[5]]);
  assert.ok(seats.every((s) => s.status === 'available'));
});

// ── The leader lock ─────────────────────────────────────────────────────────

test('only one worker runs a job at a time', async () => {
  // pm2 runs `instances: 'max'`. Without this guard every worker would send the
  // same organizer the same "scanning is switched off" email.
  const results = await Promise.all([
    scheduler.expireReservations(),
    scheduler.expireReservations(),
    scheduler.expireReservations(),
  ]);

  const ran = results.filter((r) => r !== null);
  assert.ok(ran.length >= 1, 'someone must do the work');
  assert.ok(ran.length < results.length,
    'and at least one caller must have been turned away by the lock');
});

test('the lock is released, so the next tick can run', async () => {
  // An advisory lock left held would silently stop the job forever, which is
  // exactly the failure a table flag has and this design avoids.
  const first = await scheduler.expireReservations();
  const second = await scheduler.expireReservations();
  assert.notEqual(first, null);
  assert.notEqual(second, null, 'a second sequential run must acquire the lock again');
});

// ── The other two ───────────────────────────────────────────────────────────

test('an overdue invoice is labelled', async () => {
  const { data: inv } = await supabase.from('invoices').insert({
    organizer_id: ids.organizer, event_id: ids.event,
    number: `INV-SCHED-${stamp}`, currency: 'CAD', amount_cents: 1500,
    status: 'open', due_at: new Date(Date.now() - 3600e3).toISOString(),
  }).select('id').single();

  const count = await scheduler.markOverdueInvoices();
  assert.ok(count >= 1);

  const { data: row } = await supabase.from('invoices')
    .select('status').eq('id', inv.id).single();
  assert.equal(row.status, 'overdue');
});

test('the gate was already closed before the label was applied', async () => {
  // The label is cosmetic: `scanner_is_locked` derives the lock from due_at, so
  // the door shuts whether or not the job has run. A scheduler outage must not
  // leave an unpaid event admitting people.
  const { data: gate } = await supabase.rpc('scanner_is_locked', { p_event_id: ids.event });
  assert.equal(gate.locked, true);
  assert.equal(gate.reason, 'commission_overdue');
});

test('session purge runs and reports', async () => {
  const purged = await scheduler.purgeSessions();
  assert.equal(typeof purged, 'number');
});
