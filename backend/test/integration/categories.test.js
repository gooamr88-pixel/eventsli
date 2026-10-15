const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * ONE CATEGORY SYSTEM, END TO END (2026-10-15).
 *
 * The categories live in `event_categories`, and every surface has to agree
 * with it: the list an organizer picks from, the label on a card, the /events
 * filter, a search for the category's name, and the Super Admin's event list.
 * Each of those used to read its own copy, and three of thirteen disagreed.
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = { events: [], users: [] };
let superCookie;

async function event(key, category) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `cat-${key}-${stamp}`,
    // Titles that never contain the category's name, so a match can only have
    // come through the category.
    title: `Evening ${key} ${stamp}`, venue_name: 'Hall', city: 'Toronto',
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
    terms_accepted_id: terms.id, purchase_mode: 'seat_and_table', category,
    starts_at: new Date(Date.now() + 10 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 10 * 86400e3 + 3600e3).toISOString(),
  }).select('id, slug').single();
  if (error) throw new Error(`seed ${key}: ${error.message}`);
  ids.events.push(data.id);
  ids[key] = data.slug;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `cat-org-${stamp}@eventsli-test.invalid`, full_name: 'Cat', role: 'organizer',
  }).select('id').single();
  ids.users.push(profile.id);
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Cat Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  await event('laughs', 'comedy');
  await event('banquet', 'gala');
  await event('band', 'music');

  const email = `cat-super-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: 'Cat Super' }),
  });
  const superId = (await reg.json()).data.id;
  ids.users.push(superId);
  await supabase.from('profiles')
    .update({ role: 'super_admin', email_verified_at: new Date().toISOString() }).eq('id', superId);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  superCookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  for (const id of ids.events) await supabase.from('events').delete().eq('id', id);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  for (const id of ids.users) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

const getJson = async (path, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const mine = (rows) => rows.filter((e) => String(e.slug).endsWith(`-${stamp}`)).map((e) => e.slug).sort();

test('the public list carries every category, with the added ones, labelled', async () => {
  const { status, body } = await getJson('/public/event-categories');
  assert.equal(status, 200);
  const bySlug = Object.fromEntries(body.data.labelled.map((c) => [c.slug, c.label]));
  assert.equal(bySlug.gala, 'Galas & banquets');
  assert.equal(bySlug.arts, 'Arts & theatre');
  for (const slug of ['holiday', 'dance', 'outdoors', 'wellness', 'fashion', 'conference', 'tech', 'charity', 'culture', 'faith']) {
    assert.ok(bySlug[slug], `${slug} is offered`);
  }
  // No slug twice, and no label twice — two categories a buyer cannot tell apart.
  const labels = body.data.labelled.map((c) => c.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(new Set(body.data.categories).size, body.data.categories.length);
});

test('a card names its category the way the database does', async () => {
  const { body } = await getJson(`/public/events?category=gala&limit=50`);
  const card = body.data.find((e) => e.slug === ids.banquet);
  assert.ok(card, 'the gala event is listed under gala');
  assert.equal(card.category, 'gala');
  assert.equal(card.categoryLabel, 'Galas & banquets');
});

test('the category filter returns that category and nothing else', async () => {
  const { body } = await getJson(`/public/events?category=comedy&limit=50`);
  assert.deepEqual(mine(body.data), [ids.laughs]);
  assert.ok(body.data.every((e) => e.category === 'comedy'));
});

test('searching a category by name finds its events even when no title says it', async () => {
  const bySlug = await getJson(`/public/events?q=comedy&limit=50`);
  assert.ok(mine(bySlug.body.data).includes(ids.laughs), 'q=comedy finds the comedy event');
  assert.ok(!mine(bySlug.body.data).includes(ids.band));

  const byLabel = await getJson(`/public/events?q=banquets&limit=50`);
  assert.ok(mine(byLabel.body.data).includes(ids.banquet), 'q=banquets finds the gala by its label');

  // Two letters match too much to mean a category.
  const short = await getJson(`/public/events?q=ga&limit=50`);
  assert.ok(!mine(short.body.data).includes(ids.banquet));
});

test('an unknown category is a 400 that names the choices, not an empty page', async () => {
  await getJson('/public/event-categories'); // the validator knows the list once it is loaded
  const { status, body } = await getJson(`/public/events?category=not-a-category`);
  assert.equal(status, 400, JSON.stringify(body));
  assert.match(JSON.stringify(body), /Choose one of/);
});

test('the Super Admin event list filters by category and labels each row', async () => {
  const { status, body } = await getJson(`/admin/events?category=gala&q=${stamp}&limit=50`, superCookie);
  assert.equal(status, 200, JSON.stringify(body).slice(0, 300));
  const rows = body.data.filter((e) => String(e.title).includes(String(stamp)));
  assert.deepEqual(rows.map((e) => e.id), [ids.events[1]]);
  assert.equal(rows[0].categoryLabel, 'Galas & banquets');

  const bad = await getJson(`/admin/events?category=not-a-category`, superCookie);
  assert.equal(bad.status, 400);
});

test('the Super Admin event list is not open to the public', async () => {
  const { status } = await getJson(`/admin/events?category=gala`);
  assert.equal(status, 401);
});
