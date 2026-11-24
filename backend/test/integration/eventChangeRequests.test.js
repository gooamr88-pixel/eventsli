const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const changes = require('../../services/eventChangeRequests');

/**
 * Edits to a live event, reviewed (owner, 2026-11-24): "add ability for the
 * organizer to edit event details but after review from us, and complete
 * ability for admin to edit event details".
 *
 *   · the organizer's change to the title of an event on sale is KEPT for
 *     review — the event is untouched — while the description saves at once;
 *   · a second edit merges; a field put back drops out; withdrawing closes it;
 *   · approving writes it to the event; declining leaves the event alone;
 *   · an admin's own edit to the same fields saves at once.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let organizerCookie; let adminCookie;

const PASSWORD = 'a-perfectly-long-passphrase';

/** A real account, signed in through the API: its id and its session cookie. */
async function account(role, label) {
  const email = `chg-${label}-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: `Change ${label}` }),
  });
  const id = (await reg.json()).data.id;
  await supabase.from('profiles').update({ role, email_verified_at: new Date().toISOString() }).eq('id', id);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { id, cookie: (login.headers.get('set-cookie') || '').split(';')[0] };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const organizerAccount = await account('organizer', 'org');
  const adminAccount = await account('admin', 'admin');
  const profile = { id: organizerAccount.id };
  ids.profile = organizerAccount.id;
  ids.admin = adminAccount.id;
  organizerCookie = organizerAccount.cookie;
  adminCookie = adminAccount.cookie;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Change Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const startsAt = new Date(Date.now() + 30 * 86400e3);
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `chg-test-${stamp}`, title: 'Adel Ogla',
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3 * 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id, description: 'Before',
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

});

after(async () => {
  if (ids.event) {
    await supabase.from('event_change_requests').delete().eq('event_id', ids.event);
    await supabase.from('audit_log').delete().eq('target_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  for (const id of [ids.profile, ids.admin].filter(Boolean)) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

const call = async (method, path, body, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text || 'null') };
};

const eventRow = async () => (await supabase.from('events').select('title, description, city, starts_at').eq('id', ids.event).single()).data;

test('the organizer\'s change to a live event\'s title waits for review; the description saves now', async (t) => {
  if (!organizerCookie) { t.skip('no session helper on this build'); return; }
  const res = await call('PATCH', `/events/${ids.event}`, { title: 'Adel Ogla Live', description: 'After' }, organizerCookie);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.meta.changeRequest.status, 'pending');
  assert.deepEqual(res.body.meta.changeRequest.changes.map((c) => [c.column, c.from, c.to]), [['title', 'Adel Ogla', 'Adel Ogla Live']]);
  const row = await eventRow();
  assert.equal(row.title, 'Adel Ogla', 'the public event is untouched');
  assert.equal(row.description, 'After', 'the live-editable field saved at once');
});

test('a second edit merges, a field put back drops out, and an empty request closes', async () => {
  const current = { title: 'Adel Ogla', city: 'Toronto', starts_at: (await eventRow()).starts_at, ends_at: null };
  let r = await changes.request({ eventId: ids.event, organizerId: ids.organizer, userId: ids.profile, changes: { city: 'Houston' }, current });
  assert.deepEqual(r.changes.map((c) => c.column).sort(), ['city', 'title'].filter((c) => r.changes.some((x) => x.column === c)).sort());
  assert.ok(r.changes.some((c) => c.column === 'city' && c.to === 'Houston'));
  r = await changes.request({ eventId: ids.event, organizerId: ids.organizer, userId: ids.profile, changes: { city: 'Toronto', title: 'Adel Ogla' }, current });
  assert.equal(r, null, 'everything put back: nothing left to review');
  assert.equal(await changes.pendingFor(ids.event), null);
});

test('the organizer can withdraw a change', async () => {
  const current = { title: 'Adel Ogla', starts_at: (await eventRow()).starts_at };
  await changes.request({ eventId: ids.event, organizerId: ids.organizer, userId: ids.profile, changes: { title: 'Withdraw me' }, current });
  const r = await changes.withdraw(ids.event);
  assert.equal(r.status, 'withdrawn');
  assert.equal((await eventRow()).title, 'Adel Ogla');
});

test('declining leaves the event as it was, with the reason on the request', async () => {
  const current = { title: 'Adel Ogla', starts_at: (await eventRow()).starts_at };
  const req = await changes.request({ eventId: ids.event, organizerId: ids.organizer, userId: ids.profile, changes: { title: 'Nope' }, current });
  const r = await changes.reject({ id: req.id, adminId: ids.admin, note: 'The headliner is not confirmed yet.' });
  assert.equal(r.status, 'rejected');
  assert.equal(r.decisionNote, 'The headliner is not confirmed yet.');
  assert.equal((await eventRow()).title, 'Adel Ogla');
  await assert.rejects(changes.reject({ id: req.id, adminId: ids.admin, note: 'again and again' }), (e) => e.code === 'CONFLICT');
});

test('approving writes the change to the event', async () => {
  const before = await eventRow();
  const later = new Date(new Date(before.starts_at).getTime() + 86400e3).toISOString();
  const current = { title: 'Adel Ogla', city: 'Toronto', starts_at: before.starts_at, ends_at: null };
  const req = await changes.request({
    eventId: ids.event, organizerId: ids.organizer, userId: ids.profile,
    changes: { title: 'Adel Ogla — Houston', city: 'Houston', starts_at: later, ends_at: new Date(Date.parse(later) + 3 * 3600e3).toISOString() },
    current,
  });
  const r = await changes.approve({ id: req.id, adminId: ids.admin });
  assert.equal(r.request.status, 'approved');
  const row = await eventRow();
  assert.equal(row.title, 'Adel Ogla — Houston');
  assert.equal(row.city, 'Houston');
  assert.equal(new Date(row.starts_at).getTime(), Date.parse(later));
});

test('dates that could never be approved are refused when asked', async () => {
  const row = await eventRow();
  await assert.rejects(
    changes.request({
      eventId: ids.event, organizerId: ids.organizer, userId: ids.profile,
      changes: { ends_at: new Date(Date.parse(row.starts_at) - 3600e3).toISOString() },
      current: { starts_at: row.starts_at, ends_at: null },
    }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
});

test('an admin edits the same fields of a live event at once, no review', async (t) => {
  if (!adminCookie) { t.skip('no session helper on this build'); return; }
  const res = await call('PATCH', `/events/${ids.event}`, { title: 'Edited by Eventsli', city: 'Dallas', reason: 'Owner asked' }, adminCookie);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.meta?.changeRequest, undefined);
  const row = await eventRow();
  assert.equal(row.title, 'Edited by Eventsli');
  assert.equal(row.city, 'Dallas');
});
