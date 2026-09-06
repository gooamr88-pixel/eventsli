const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * BRD §27 — password-protected tables, end to end.
 *
 * The property that matters is NOT "the UI hides it". It is that a protected
 * table is absent from the bytes on the wire. A `locked: true` flag hides a
 * table from the rendered page and from nobody else — its label, price and
 * seat count sit in the JSON, one DevTools panel away from someone who was
 * never given the password.
 *
 * So these tests read the raw response and assert the table is not in it.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let publicTableId; let privateTableId; let privateSeatIds = [];

const PASSWORD = 'family-table-2026';

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `priv-${stamp}@eventsli-test.invalid`, full_name: 'Priv Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Priv Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id,
    slug: `priv-test-${stamp}`,
    title: 'Private Table Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id; ids.slug = ev.slug;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;

  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'Standard', price_cents: 5000 }).select('id').single();
  ids.tier = tier.id;

  const { hashTablePassword } = require('../../services/tableAccessService');

  const { data: pub } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'Open Table', seat_count: 4, price_cents: 18000,
  }).select('id').single();
  publicTableId = pub.id;

  const { data: priv } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'VIP Family Table', seat_count: 6, price_cents: 90000,
    is_private: true, password_hash: await hashTablePassword(PASSWORD),
  }).select('id').single();
  privateTableId = priv.id;

  for (const [tid, label, n] of [[pub.id, 'Open Table', 4], [priv.id, 'VIP Family Table', 6]]) {
    const rows = Array.from({ length: n }, (_, i) => ({
      venue_map_id: map.id, table_id: tid, tier_id: tier.id,
      section_key: label, row_label: 'A', seat_number: String(i + 1),
    }));
    const { data } = await supabase.from('seats').insert(rows).select('id');
    if (tid === priv.id) privateSeatIds = data.map((r) => r.id);
  }
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  if (ids.event) {
    const { data: res } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of res || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('tables').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || 'null') };
};

// ── The privacy guarantee ───────────────────────────────────────────────────

test('a private table is absent from the raw public payload', async () => {
  const res = await call('GET', `/public/events/${ids.slug}/seat-map`);
  assert.equal(res.status, 200);

  // Read the BYTES, not the parsed shape. This is the assertion that a
  // `locked: true` flag would fail.
  assert.equal(res.text.includes('VIP Family Table'), false, 'the label leaked');
  assert.equal(res.text.includes(privateTableId), false, 'the id leaked');
  assert.equal(res.text.includes('90000'), false, 'the price leaked');

  const labels = res.body.data.tables.map((t) => t.label);
  assert.deepEqual(labels, ['Open Table']);
});

test('its seats are hidden with it', async () => {
  const res = await call('GET', `/public/events/${ids.slug}/seat-map`);
  for (const id of privateSeatIds) {
    assert.equal(res.text.includes(id), false, 'a seat of a hidden table leaked its table');
  }
  assert.equal(res.body.data.seats.length, 4, 'only the open table\'s seats');
});

test('the map says how many are hidden without naming them', async () => {
  const res = await call('GET', `/public/events/${ids.slug}/seat-map`);
  assert.equal(res.body.data.hiddenTableCount, 1);
});

test('a wrong password reveals nothing', async () => {
  const res = await call('POST', `/public/events/${ids.slug}/tables/${privateTableId}/unlock`, {
    password: 'not-the-password',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'TABLE_PASSWORD_INVALID');
  assert.equal(res.text.includes('VIP Family Table'), false);
});

test('a password on a table that is NOT private is refused the same way', async () => {
  // Otherwise the difference between the two answers tells an attacker exactly
  // which tables are worth guessing at.
  const res = await call('POST', `/public/events/${ids.slug}/tables/${publicTableId}/unlock`, {
    password: PASSWORD,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'TABLE_PASSWORD_INVALID');
});

test('a made-up table id is refused the same way', async () => {
  const res = await call('POST',
    `/public/events/${ids.slug}/tables/00000000-0000-0000-0000-000000000000/unlock`,
    { password: PASSWORD });
  assert.equal(res.status, 403, 'must not distinguish "no such table" from "wrong password"');
});

// ── Unlocking ───────────────────────────────────────────────────────────────

test('the right password returns a token, and the table appears', async () => {
  const unlock = await call('POST', `/public/events/${ids.slug}/tables/${privateTableId}/unlock`, {
    password: PASSWORD,
  });
  assert.equal(unlock.status, 200, JSON.stringify(unlock.body));
  const token = unlock.body.data.token;
  assert.ok(token);

  const res = await call('GET', `/public/events/${ids.slug}/seat-map`, null, {
    'x-table-access': token,
  });
  const labels = res.body.data.tables.map((t) => t.label).sort();
  assert.deepEqual(labels, ['Open Table', 'VIP Family Table']);
  assert.equal(res.body.data.hiddenTableCount, 0);
  assert.equal(res.body.data.seats.length, 10, 'now both tables\' seats');
});

test('a token unlocks ONE table, not every private table', async () => {
  const { hashTablePassword } = require('../../services/tableAccessService');
  const { data: other } = await supabase.from('tables').insert({
    venue_map_id: ids.map, label: 'Second Private', seat_count: 2, price_cents: 40000,
    is_private: true, password_hash: await hashTablePassword('a-different-password'),
  }).select('id').single();

  const unlock = await call('POST', `/public/events/${ids.slug}/tables/${privateTableId}/unlock`,
    { password: PASSWORD });

  const res = await call('GET', `/public/events/${ids.slug}/seat-map`, null, {
    'x-table-access': unlock.body.data.token,
  });
  const labels = res.body.data.tables.map((t) => t.label);
  assert.ok(labels.includes('VIP Family Table'));
  assert.equal(labels.includes('Second Private'), false, 'one password must not open the rest');

  await supabase.from('tables').delete().eq('id', other.id);
});

test('a session cookie cannot be replayed as a table key', async () => {
  // Both are signed with the same secret; only the `typ` claim separates them.
  const reg = await call('POST', '/auth/register', {
    email: `tok-${stamp}@eventsli-test.invalid`,
    password: 'a-perfectly-long-passphrase',
    fullName: 'Token Test',
  });
  const setCookie = reg.body ? null : null;
  const { data: p } = await supabase.from('profiles')
    .select('id').eq('email', `tok-${stamp}@eventsli-test.invalid`).maybeSingle();

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `tok-${stamp}@eventsli-test.invalid`, password: 'a-perfectly-long-passphrase' }),
  });
  const sessionToken = (login.headers.get('set-cookie') || '')
    .split('eventsli_session=')[1]?.split(';')[0];
  assert.ok(sessionToken, 'need a real session token to attempt the replay');

  const res = await call('GET', `/public/events/${ids.slug}/seat-map`, null, {
    'x-table-access': sessionToken,
  });
  assert.equal(res.text.includes('VIP Family Table'), false, 'a session token must not unlock a table');

  if (p) {
    await supabase.from('sessions').delete().eq('user_id', p.id);
    await supabase.from('profiles').delete().eq('id', p.id);
  }
});

test('garbage tokens are ignored, not fatal', async () => {
  for (const junk of ['nonsense', 'a.b.c', '', 'Bearer x']) {
    const res = await call('GET', `/public/events/${ids.slug}/seat-map`, null, {
      'x-table-access': junk,
    });
    assert.equal(res.status, 200, `"${junk}" should degrade to the locked view, not error`);
    assert.equal(res.text.includes('VIP Family Table'), false);
  }
});

// ── Buying ──────────────────────────────────────────────────────────────────

test('a private table cannot be booked without its token', async () => {
  // The password must gate the PURCHASE too. Gating only the map would leave
  // anyone who guessed the id free to buy a table they could never see.
  const res = await call('POST', `/public/events/${ids.slug}/hold`, { tableId: privateTableId });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'TABLE_PASSWORD_REQUIRED');
});

test('with the token, it can be booked', async () => {
  const unlock = await call('POST', `/public/events/${ids.slug}/tables/${privateTableId}/unlock`,
    { password: PASSWORD });

  const res = await call('POST', `/public/events/${ids.slug}/hold`, { tableId: privateTableId },
    { 'x-table-access': unlock.body.data.token });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.seatCount, 6);
  assert.equal(res.body.data.subtotalCents, 90000);

  // Releasing now needs the token the hold handed back — a bare id is not
  // authority to drop someone else's seats.
  await call('POST', `/public/reservations/${res.body.data.reservationId}/release`, null,
    { 'x-access-token': res.body.data.reservationToken });
});

test('an open table needs no token, and guests may hold', async () => {
  const res = await call('POST', `/public/events/${ids.slug}/hold`, { tableId: publicTableId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.subtotalCents, 18000);
  // Releasing now needs the token the hold handed back — a bare id is not
  // authority to drop someone else's seats.
  await call('POST', `/public/reservations/${res.body.data.reservationId}/release`, null,
    { 'x-access-token': res.body.data.reservationToken });
});

test('seats and a table cannot be held in one request', async () => {
  const res = await call('POST', `/public/events/${ids.slug}/hold`, {
    tableId: publicTableId, seatIds: [privateSeatIds[0]],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /either seats or a whole table/i);
});

test('an unpublished event is a 404 from outside', async () => {
  await supabase.from('events').update({ status: 'suspended' }).eq('id', ids.event);
  const res = await call('GET', `/public/events/${ids.slug}/seat-map`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'EVENT_NOT_FOUND');
  await supabase.from('events').update({ status: 'published' }).eq('id', ids.event);
});
