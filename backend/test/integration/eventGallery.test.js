const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

/**
 * THE GALLERY, OVER HTTP (2026-10-16).
 *
 * Adding a gallery photo answered 500 in production — the organizer saw
 * "Something went wrong on our side" under a toast claiming "3 photos added".
 * Nothing tested this endpoint: the upload is signed and the bytes go straight
 * to Storage, which the local stack does not have, so the one step that needs
 * Storage (confirming the object exists) is stubbed here and everything else —
 * the route, the guards, the validator, the insert, the reply — is real.
 */
const media = require('../../services/mediaService');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

let server; let baseUrl; let cookie;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = {};
const realAttach = media.attach;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const email = `gal-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: 'Gallery Owner' }),
  });
  ids.user = (await reg.json()).data.id;
  await supabase.from('profiles').update({ role: 'organizer', email_verified_at: new Date().toISOString() }).eq('id', ids.user);
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.user, display_name: 'Gallery Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `gal-${stamp}`, title: 'Gallery Test', country: 'CA',
    timezone: 'America/Toronto', currency: 'CAD', status: 'draft', terms_accepted_id: terms.id,
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  ids.event = ev.id;

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  media.attach = realAttach;
  if (ids.event) await supabase.from('events').delete().eq('id', ids.event);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.user) {
    await supabase.from('sessions').delete().eq('user_id', ids.user);
    await supabase.from('profiles').delete().eq('id', ids.user);
  }
  await new Promise((r) => server.close(r));
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('an uploaded photo is added to the gallery and listed', async () => {
  const path = `events/${ids.event}/gallery-0123456789abcdef.jpg`;
  media.attach = async ({ eventId, path: p }) => ({
    url: `https://example.supabase.co/storage/v1/object/public/event-media/${p}`, path: p, eventId,
  });
  const res = await call('POST', `/events/${ids.event}/media`, { kind: 'image', path });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.kind, 'image');

  const list = await call('GET', `/events/${ids.event}/media`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
});

test('a video link is added to the gallery', async () => {
  const res = await call('POST', `/events/${ids.event}/media`, { kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.kind, 'video');
});

test('the database still refuses a link that is not http(s)', async () => {
  // The route validates first; this proves the CHECK itself, which is the
  // line that matters if a route ever forgets.
  const { error } = await supabase.from('event_media').insert({
    event_id: ids.event, kind: 'video', url: 'javascript:alert(1)',
  });
  assert.ok(error, 'javascript: must be refused');
  assert.match(error.message, /media_url_is_http/);
  const long = await supabase.from('event_media').insert({
    event_id: ids.event, kind: 'video', url: `https://example.com/${'a'.repeat(2100)}`,
  });
  assert.ok(long.error, 'a 2,000+ character URL must be refused');
});

test('an event sponsor with a website link saves', async () => {
  // Same broken bound on `event_sponsors.link_url`: a sponsor WITHOUT a link
  // saved, one with a link was a 500.
  const res = await call('POST', `/events/${ids.event}/sponsors`, {
    name: 'Harbour Bank', level: 'gold', linkUrl: 'https://example.com/harbour',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.linkUrl, 'https://example.com/harbour');
});
