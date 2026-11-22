const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');
const { BUCKET } = require('../../services/mediaService');

/**
 * What a private event shows before its password (2026-11-22, the owner:
 * "blur all details and images until it is unlocked — the organizer decides"),
 * against the real database:
 *
 *   · the organizer chooses blurred page or plain card, and what stays readable;
 *   · a locked visitor receives only those details — never the description,
 *     the venue or the cover's own address;
 *   · a hidden cover is served as a tiny blurred copy, and only while hidden.
 */
const stamp = Date.now();
const ids = { profiles: [], organizer: null, event: null, coverPath: null };
let server; let base; let token; let slug;

async function call(method, path, body, auth) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') || '';
  return {
    status: res.status, type,
    body: type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()),
  };
}

let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }
// The image test needs local Storage too; it is skipped where Storage is not running.
let stored = false;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const email = `preview-owner-${stamp}@eventsli-test.invalid`;
  const { data: owner, error } = await supabase.from('profiles').insert({
    email, full_name: 'Preview Owner', role: 'organizer', email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  ids.profiles.push(owner.id);
  ({ token } = await sessions.issue(null, { userId: owner.id, email, role: 'organizer', cookie: false }));
  const { data: org } = await supabase.from('organizers').insert({ owner_user_id: owner.id, display_name: 'Preview Host', country: 'CA' }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();

  const { data: ev, error: evError } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `secret-supper-${stamp}`, title: 'Secret Supper', country: 'CA',
    timezone: 'America/Toronto', city: 'Toronto', venue_name: 'Hidden Loft', venue_address: '9 Quiet Lane',
    description: 'Seven courses at a long candlelit table.',
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3 * 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
  }).select('id, slug').single();
  if (evError) throw new Error(evError.message);
  ids.event = ev.id;
  slug = ev.slug;

  // A real cover in storage, so the blurred copy can be made from it.
  if (sharp) {
    const jpeg = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 200, g: 40, b: 60 } } }).jpeg().toBuffer();
    ids.coverPath = `events/${ev.id}/cover-${stamp}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(ids.coverPath, jpeg, { contentType: 'image/jpeg', upsert: true })
      .catch((err) => ({ error: err }));
    stored = !up.error;
    // Without Storage the row still gets a cover, so the teaser rules are tested.
    const url = stored ? supabase.storage.from(BUCKET).getPublicUrl(ids.coverPath).data.publicUrl : 'https://storage.example/cover.jpg';
    if (!stored) ids.coverPath = null;
    await supabase.from('events').update({ cover_path: ids.coverPath || 'events/x/cover.jpg', cover_url: url }).eq('id', ev.id);
  }
});

after(async () => {
  if (ids.coverPath) await supabase.storage.from(BUCKET).remove([ids.coverPath]);
  if (ids.event) await supabase.from('events').delete().eq('id', ids.event);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

test('by default: a blurred page, the name and host readable, nothing else sent', async () => {
  const set = await call('PUT', `/events/${ids.event}/privacy`, { isPrivate: true, password: 'candles' }, token);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.lockedPreview, 'blur');
  assert.deepEqual(set.body.data.lockedReveal, ['title', 'organizer']);

  const locked = await call('GET', `/public/events/${slug}?locked=ok`);
  assert.equal(locked.status, 200, JSON.stringify(locked.body));
  const teaser = locked.body.data.event;
  assert.equal(locked.body.data.locked, true);
  assert.equal(teaser.preview, 'blur');
  assert.equal(teaser.title, 'Secret Supper');
  assert.equal(teaser.organizer.name, 'Preview Host');
  assert.equal(teaser.coverUrl, null);
  assert.equal(teaser.startsAt, null);
  const text = JSON.stringify(locked.body);
  for (const secret of ['Hidden Loft', '9 Quiet Lane', 'candlelit', 'Toronto', 'cover.jpg', 'cover-']) {
    assert.ok(!text.includes(secret), `"${secret}" must not reach a locked visitor`);
  }
});

test('the blurred cover is a tiny copy, served only while the cover is hidden', async (t) => {
  if (!sharp || !stored) { t.skip(!sharp ? 'sharp is not installed' : 'local Storage is not running'); return; }
  const img = await call('GET', `/public/events/${slug}/locked-cover`);
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/jpeg');
  const meta = await sharp(img.body).metadata();
  assert.equal(meta.width, 24, 'twenty-four pixels across: colour, no detail');
  assert.ok(img.body.length < 4000);
});

test('the organizer shows everything but the details, as a plain card', async () => {
  const set = await call('PUT', `/events/${ids.event}/privacy`, {
    isPrivate: true, lockedPreview: 'card', lockedReveal: ['cover', 'date', 'city'],
  }, token);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.data.lockedReveal, ['cover', 'date', 'city']);

  const teaser = (await call('GET', `/public/events/${slug}?locked=ok`)).body.data.event;
  assert.equal(teaser.preview, 'card');
  assert.equal(teaser.title, null, 'the name was not ticked');
  assert.equal(teaser.organizer, null);
  assert.equal(teaser.city, 'Toronto');
  assert.equal(teaser.timezone, 'America/Toronto');
  assert.ok(teaser.startsAt);
  assert.equal(teaser.blurredCover, false);
  assert.ok(teaser.coverUrl, 'the cover was ticked, so it is sent');
  {
    assert.equal((await call('GET', `/public/events/${slug}/locked-cover`)).status, 404, 'a shown cover has no blurred copy');
  }

  const bad = await call('PUT', `/events/${ids.event}/privacy`, { isPrivate: true, lockedReveal: ['venue'] }, token);
  assert.equal(bad.status, 400);
  const badMode = await call('PUT', `/events/${ids.event}/privacy`, { isPrivate: true, lockedPreview: 'fog' }, token);
  assert.equal(badMode.status, 400);
});

test('the organizer reads the setting back with the event', async () => {
  const own = await call('GET', `/events/${ids.event}`, null, token);
  assert.equal(own.status, 200);
  assert.equal(own.body.data.privacy.lockedPreview, 'card');
  assert.deepEqual(own.body.data.privacy.lockedReveal, ['cover', 'date', 'city']);
});

test('a public event has no blurred cover', async () => {
  await call('PUT', `/events/${ids.event}/privacy`, { isPrivate: false }, token);
  assert.equal((await call('GET', `/public/events/${slug}/locked-cover`)).status, 404);
});
