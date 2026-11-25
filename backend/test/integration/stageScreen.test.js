const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const sessions = require('../../services/sessionService');
const app = require('../../app');

/**
 * THE STAGE SCREEN, end to end (2026-11-25): what the 3D room's LED wall
 * shows by itself comes from the event — its lineup and sponsors — through
 * both map reads, and the screen's settings survive the map save cleaned.
 */
let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let token;

async function seed() {
  const email = `screen-${stamp}@eventsli-test.invalid`;
  const { data: profile } = await supabase.from('profiles').insert({
    email, full_name: 'Screen Test', role: 'organizer', email_verified_at: new Date().toISOString(),
  }).select('id').single();
  ids.profile = profile.id;
  ({ token } = await sessions.issue(null, { userId: profile.id, email, role: 'organizer', cookie: false }));

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Screen Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const starts = new Date(Date.now() + 30 * 86400e3);
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `screen-test-${stamp}`, title: 'Screen Test Night',
    country: 'CA', timezone: 'America/Toronto', venue_name: 'Riverside Arena',
    starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3 * 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id, purchase_mode: 'seat_only',
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id; ids.slug = ev.slug;

  const { data: map } = await supabase.from('venue_maps').insert({
    event_id: ev.id,
    layout_json: { scene: { mood: 'gala', screens: true, screen: { style: 'elegant', slides: [{ id: 'm', kind: 'message', text: 'Welcome' }] } } },
  }).select('id').single();
  ids.map = map.id;
  const { data: table } = await supabase.from('tables').insert({ venue_map_id: map.id, label: 'R1', seat_count: 2 }).select('id').single();
  ids.table = table.id;

  await supabase.from('event_schedule').insert([
    { event_id: ev.id, title: 'Doors', starts_at: new Date(starts.getTime() - 3600e3).toISOString(), sort_order: 0 },
    { event_id: ev.id, title: 'The Headliner', starts_at: starts.toISOString(), location: 'Main stage', sort_order: 1 },
  ]);
  await supabase.from('event_sponsors').insert({ event_id: ev.id, name: 'Acme', level: 'gold' });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  if (ids.event) {
    await supabase.from('event_schedule').delete().eq('event_id', ids.event);
    await supabase.from('event_sponsors').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('tables').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('sessions').delete().eq('user_id', ids.profile).then(() => {}, () => {});
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

const call = async (method, path, body, auth = false) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text || 'null') };
};
const data = (r) => r.body?.data ?? r.body;

test('the public seat map carries the screen feed: times, venue, lineup in order, sponsors', async () => {
  const res = await call('GET', `/public/events/${ids.slug}/seat-map`);
  assert.equal(res.status, 200);
  const feed = data(res).screenFeed;
  assert.ok(feed, 'screenFeed is on the payload');
  assert.equal(feed.title, 'Screen Test Night');
  assert.equal(feed.venueName, 'Riverside Arena');
  assert.equal(feed.timezone, 'America/Toronto');
  assert.deepEqual(feed.lineup.map((r) => r.title), ['Doors', 'The Headliner']);
  assert.equal(feed.lineup[1].location, 'Main stage');
  assert.deepEqual(feed.sponsors.map((s) => s.name), ['Acme']);
  // The screen's settings ride the layout as saved.
  assert.equal(data(res).map.layout.scene.screen.style, 'elegant');
});

test('the organizer’s map read carries the same feed, for the settings preview', async () => {
  const res = await call('GET', `/events/${ids.event}/venue-map`, null, true);
  assert.equal(res.status, 200);
  assert.deepEqual(data(res).screenFeed.lineup.map((r) => r.title), ['Doors', 'The Headliner']);
});

test('a soundtrack upload is signed only as audio, and an image kind never as audio', async () => {
  const ok = await call('POST', `/events/${ids.event}/venue-map/upload`, { contentType: 'audio/mpeg', kind: 'soundtrack' }, true);
  // Signing needs storage; a stack without it answers STORAGE_NOT_CONFIGURED,
  // never a validation error. Either way the pairing was accepted.
  if (ok.status === 200) assert.match(data(ok).path, new RegExp(`^events/${ids.event}/soundtrack-[0-9a-f]{16}\\.mp3$`));
  else assert.notEqual(ok.body?.error, 'VALIDATION_ERROR');

  const audioAsImage = await call('POST', `/events/${ids.event}/venue-map/upload`, { contentType: 'audio/mpeg', kind: 'screen' }, true);
  assert.equal(audioAsImage.status, 415);
  const imageAsAudio = await call('POST', `/events/${ids.event}/venue-map/upload`, { contentType: 'image/png', kind: 'soundtrack' }, true);
  assert.equal(imageAsAudio.status, 415);
});
