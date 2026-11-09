const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const venue = require('../../services/venueService');

/**
 * Venue Studio: blocking seats, and the layout blob's image paths.
 *
 * The property that matters for blocking: it moves seats between `available`
 * and `blocked` ONLY. A held or sold seat belongs to a buyer, and this must
 * never be a way to take it back or put it on sale twice.
 */
const stamp = Date.now();
const ids = {};

before(async () => {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `vstudio-${stamp}@eventsli-test.invalid`, full_name: 'Studio Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Studio Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `vstudio-${stamp}`, title: 'Venue Studio Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 40 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  await venue.saveMap(ids.event, {
    layout: {},
    tables: [{
      label: 'A1 H', seatCount: 6, priceCents: null, seatPriceCents: 5000, isPrivate: false,
      position: { x: 50, y: 50, rotation: 0 }, shape: 'row',
    }],
  });
  const map = await venue.getMapForOrganizer(ids.event);
  ids.table = map.tables[0].id;
  ids.seats = map.tables[0].seats.map((s) => s.id).sort();
});

after(async () => {
  if (ids.event) {
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    const { data: m } = await supabase.from('venue_maps').select('id').eq('event_id', ids.event).maybeSingle();
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

const statusOf = async (id) => (await supabase.from('seats').select('status').eq('id', id).single()).data.status;

test('blocked seats cannot be held, and released seats can', async () => {
  const [s1, s2] = ids.seats;
  const res = await venue.setSeatAvailability(ids.event, [s1, s2], true);
  assert.deepEqual(res.changed.sort(), [s1, s2].sort());
  assert.equal(await statusOf(s1), 'blocked');

  const { data: refused } = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [s1], p_ttl_minutes: 5,
  });
  assert.equal(refused?.ok, false, 'a blocked seat is not on sale through any hold path');

  const back = await venue.setSeatAvailability(ids.event, [s1], false);
  assert.deepEqual(back.changed, [s1]);
  const { data: held } = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [s1], p_ttl_minutes: 5,
  });
  assert.equal(held?.ok, true);
  ids.heldSeat = s1;
});

test('a held seat is never blocked or released by the organizer', async () => {
  const res = await venue.setSeatAvailability(ids.event, [ids.heldSeat, ids.seats[2]], true);
  assert.deepEqual(res.changed, [ids.seats[2]], 'only the available seat changed');
  assert.equal(res.unchanged, 1);
  assert.equal(await statusOf(ids.heldSeat), 'held');

  const release = await venue.setSeatAvailability(ids.event, [ids.heldSeat], false);
  assert.deepEqual(release.changed, []);
  assert.equal(await statusOf(ids.heldSeat), 'held', 'releasing never puts a buyer\'s seat back on sale');
});

test('a seat from another map is untouched', async () => {
  const { data: other } = await supabase.from('seats').select('id').neq('venue_map_id',
    (await supabase.from('venue_maps').select('id').eq('event_id', ids.event).single()).data.id)
    .eq('status', 'available').limit(1);
  if (!other?.length) return;
  const res = await venue.setSeatAvailability(ids.event, [other[0].id], true);
  assert.deepEqual(res.changed, []);
  assert.equal(await statusOf(other[0].id), 'available');
});

test('the saved layout keeps only own image paths, with server-derived URLs', async () => {
  const own = `events/${ids.event}/panorama-0123456789abcdef.jpg`;
  await venue.saveMap(ids.event, {
    layout: {
      views: [
        { id: 'v1', name: 'Row H', kind: 'seat', path: own, url: 'https://evil.test/x.jpg', tables: ['A1 H'] },
        { id: 'v2', name: 'Theirs', path: 'events/00000000-0000-4000-8000-000000000000/panorama-0123456789abcdef.jpg' },
      ],
      scene: { rake: 18 },
    },
    tables: [{
      id: ids.table, label: 'A1 H', seatCount: 6, priceCents: null, seatPriceCents: 5000, isPrivate: false,
      position: { x: 50, y: 50, rotation: 0 }, shape: 'row',
    }],
  });
  const map = await venue.getMapForOrganizer(ids.event);
  assert.equal(map.layout.views.length, 1);
  assert.equal(map.layout.views[0].path, own);
  assert.ok(!map.layout.views[0].url.includes('evil.test'));
  assert.equal(map.layout.scene.rake, 18);
});
