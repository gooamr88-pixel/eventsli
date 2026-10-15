const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * "NEAR YOU" MUST BE GENUINELY NEAR (2026-10-15).
 *
 * The homepage now shows nearby events by default, from `/public/events/near`'s
 * new `events[]`. These pin what "nearby" means: measured to the venue when it
 * was pinned and to the city otherwise, nearest first, inside the radius, and
 * never a draft or a past event.
 */
let server; let baseUrl;
const stamp = Date.now();
const ids = { events: [] };

// Standing by the pinned venue, which is ~1.2 km from Toronto's centroid — so
// the pinned event is unambiguously the nearer of the two.
const TORONTO_VISITOR = { lat: 43.643, lng: -79.387 };
const MONTREAL_VISITOR = { lat: 45.50, lng: -73.57 };

async function event(over) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `near-${over.key}-${stamp}`, title: `Near ${over.key}`,
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
    terms_accepted_id: terms.id, purchase_mode: 'seat_and_table',
    starts_at: new Date(Date.now() + 10 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 10 * 86400e3 + 3600e3).toISOString(),
    ...over.row,
  }).select('id, slug').single();
  if (error) throw new Error(`seed ${over.key}: ${error.message}`);
  ids.events.push(data.id);
  ids[over.key] = data.slug;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `near-${stamp}@eventsli-test.invalid`, full_name: 'Near', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Near Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  // A pinned venue a kilometre from the visitor.
  await event({ key: 'pinned', row: { city: 'Toronto', venue_name: 'Waterfront Hall', venue_lat: 43.6426, venue_lng: -79.3871 } });
  // City only — measured to Toronto's centroid.
  await event({ key: 'cityonly', row: { city: 'Toronto', venue_name: 'Somewhere downtown' } });
  // 500 km away.
  await event({ key: 'montreal', row: { city: 'Montreal', venue_name: 'Old Port', venue_lat: 45.5089, venue_lng: -73.5617 } });
  // Must never appear: not published, and over.
  await event({ key: 'draft', row: { city: 'Toronto', status: 'draft', venue_lat: 43.651, venue_lng: -79.381 } });
  await event({ key: 'past', row: {
    city: 'Toronto', venue_lat: 43.652, venue_lng: -79.382,
    starts_at: new Date(Date.now() - 5 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() - 5 * 86400e3 + 3600e3).toISOString(),
  } });
});

after(async () => {
  for (const id of ids.events) await supabase.from('events').delete().eq('id', id);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) await supabase.from('profiles').delete().eq('id', ids.profile);
  await new Promise((r) => server.close(r));
});

const near = async ({ lat, lng }, radiusKm = 100) => {
  const res = await fetch(`${baseUrl}/public/events/near?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&limit=24`);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
  return body.data;
};
const mine = (events) => events.filter((e) => String(e.slug).endsWith(`-${stamp}`));

test('from Toronto: the pinned venue first, measured to the venue, then the city-only event', async () => {
  const data = await near(TORONTO_VISITOR);
  const events = mine(data.events);
  assert.deepEqual(events.map((e) => e.slug), [ids.pinned, ids.cityonly]);
  assert.equal(events[0].precise, true);
  assert.ok(events[0].distanceKm < 2, `pinned venue is ${events[0].distanceKm} km away`);
  assert.equal(events[1].precise, false, 'a city-only event is measured to the city, and says so');
  // The same card shape as /public/events.
  for (const key of ['id', 'slug', 'title', 'startsAt', 'coverUrl', 'admissionType']) assert.ok(key in events[0], key);
});

test('500 km is not near, and a draft or a past event never appears', async () => {
  const data = await near(TORONTO_VISITOR);
  const slugs = mine(data.events).map((e) => e.slug);
  assert.ok(!slugs.includes(ids.montreal));
  assert.ok(!slugs.includes(ids.draft));
  assert.ok(!slugs.includes(ids.past));
});

test('from Montreal the answer turns around', async () => {
  const data = await near(MONTREAL_VISITOR);
  const events = mine(data.events);
  assert.equal(events[0]?.slug, ids.montreal);
  assert.ok(!events.some((e) => e.slug === ids.pinned));
});

test('a wider radius reaches further, still nearest first', async () => {
  const data = await near(TORONTO_VISITOR, 1000);
  const events = mine(data.events);
  assert.deepEqual(events.map((e) => e.slug), [ids.pinned, ids.cityonly, ids.montreal]);
  const d = events.map((e) => e.distanceKm);
  assert.deepEqual([...d].sort((a, b) => a - b), d);
});

test('coordinates are validated', async () => {
  const res = await fetch(`${baseUrl}/public/events/near?lat=200&lng=0`);
  assert.equal(res.status, 400);
});
