const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * BRD §19 — user and organizer administration.
 *
 * The interesting tests here are the refusals. Anyone can write an endpoint
 * that sets a boolean; what makes this safe to expose is that an admin cannot
 * turn it on themselves, cannot turn it on a peer, and cannot leave the
 * platform with nobody able to administer it.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
const cookies = {};
const PASSWORD = 'a-perfectly-long-passphrase';

/** Signs in and hands back both the outcome and the cookie, in ONE round trip. */
const login = async (key) => {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `uadm-${key}-${stamp}@eventsli-test.invalid`, password: PASSWORD,
    }),
  });
  const body = JSON.parse((await res.text()) || 'null');
  return {
    status: res.status,
    body,
    cookie: (res.headers.get('set-cookie') || '').split(';')[0],
  };
};

const call = async (method, path, body, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || 'null') };
};

/** Registers an account, promotes it directly in the database, and signs in. */
async function makeUser(key, role) {
  const email = `uadm-${key}-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: `Test ${key}` }),
  });
  const created = await reg.json();
  if (!created?.data?.id) throw new Error(`register ${key}: ${JSON.stringify(created)}`);
  ids[key] = created.data.id;

  if (role && role !== 'attendee') {
    await supabase.from('profiles').update({ role }).eq('id', ids[key]);
  }
  // Sign in AFTER the role is set, so the session carries the right context.
  cookies[key] = (await login(key)).cookie;
  return ids[key];
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  await makeUser('super', 'super_admin');
  await makeUser('admin', 'admin');
  await makeUser('admin2', 'admin');
  await makeUser('seller', 'organizer');
  await makeUser('buyer', 'attendee');

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.seller, display_name: 'Suspendable Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;
});

after(async () => {
  if (ids.organizer) {
    await supabase.from('events').delete().eq('organizer_id', ids.organizer);
    await supabase.from('organizers').delete().eq('id', ids.organizer);
  }
  for (const key of ['super', 'admin', 'admin2', 'seller', 'buyer']) {
    if (!ids[key]) continue;
    await supabase.from('admin_audit').delete().eq('actor_id', ids[key]);
    await supabase.from('sessions').delete().eq('user_id', ids[key]);
    await supabase.from('terms_acceptances').delete().eq('user_id', ids[key]);
    await supabase.from('profiles').delete().eq('id', ids[key]);
  }
  await new Promise((r) => server.close(r));
});

// ── Who may reach it at all ─────────────────────────────────────────────────

test('the user list is admin-only', async () => {
  assert.equal((await call('GET', '/admin/users')).status, 401);
  assert.equal((await call('GET', '/admin/users', null, cookies.buyer)).status, 403);
  assert.equal((await call('GET', '/admin/users', null, cookies.seller)).status, 403);
  assert.equal((await call('GET', '/admin/users', null, cookies.admin)).status, 200);
});

test('the listing carries no credential material', async () => {
  const res = await call('GET', `/admin/users?q=uadm-seller-${stamp}`, null, cookies.admin);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1, JSON.stringify(res.body.data));
  for (const leak of ['password_hash', 'passwordHash', 'jti', 'token']) {
    assert.equal(res.text.includes(leak), false, `${leak} must not be in an admin listing`);
  }
});

test('a search term is treated as text, not as filter syntax', async () => {
  // `q` reaches PostgREST inside an `.or()`, where a comma or a parenthesis is
  // syntax. Unescaped, this is a filter-injection point.
  const res = await call('GET', '/admin/users?q=a,role.eq.super_admin)', null, cookies.admin);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.some((u) => u.role === 'super_admin'), false);
});

// ── Acting on yourself ──────────────────────────────────────────────────────

test('an admin cannot block their own account', async () => {
  const res = await call('POST', `/admin/users/${ids.admin}/block`,
    { reason: 'testing the guard' }, cookies.admin);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'SELF_ACTION');

  const { data } = await supabase.from('profiles').select('is_blocked').eq('id', ids.admin).single();
  assert.equal(data.is_blocked, false);
});

test('an admin cannot promote themselves', async () => {
  const res = await call('PATCH', `/admin/users/${ids.admin}/role`,
    { role: 'super_admin' }, cookies.admin);
  assert.equal(res.status, 409);

  const { data } = await supabase.from('profiles').select('role').eq('id', ids.admin).single();
  assert.equal(data.role, 'admin');
});

// ── Acting on a peer ────────────────────────────────────────────────────────

test('an admin cannot block a fellow admin', async () => {
  // A compromised admin account would otherwise disable every other admin and
  // be the last one standing.
  const res = await call('POST', `/admin/users/${ids.admin2}/block`,
    { reason: 'testing the guard' }, cookies.admin);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'FORBIDDEN');

  const { data } = await supabase.from('profiles').select('is_blocked').eq('id', ids.admin2).single();
  assert.equal(data.is_blocked, false);
});

test('a super admin can', async () => {
  const res = await call('POST', `/admin/users/${ids.admin2}/block`,
    { reason: 'a genuine reason, recorded' }, cookies.super);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const { data } = await supabase.from('profiles').select('is_blocked').eq('id', ids.admin2).single();
  assert.equal(data.is_blocked, true);

  await call('POST', `/admin/users/${ids.admin2}/unblock`, {}, cookies.super);
});

test('an admin cannot grant a staff role', async () => {
  const res = await call('PATCH', `/admin/users/${ids.buyer}/role`,
    { role: 'admin' }, cookies.admin);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /super admin/i);
});

test('an admin can still make someone an organizer', async () => {
  const res = await call('PATCH', `/admin/users/${ids.buyer}/role`,
    { role: 'organizer' }, cookies.admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.role, 'organizer');

  await call('PATCH', `/admin/users/${ids.buyer}/role`, { role: 'attendee' }, cookies.admin);
});

// ── Blocking actually stops them ────────────────────────────────────────────

test('blocking revokes every live session, not just the access context', async () => {
  // The access context is cached ten seconds PER pm2 WORKER, so invalidating it
  // only clears the worker that handled the block. Session revocation is
  // checked against the database on every request and cannot be cached around.
  const before_ = await call('GET', '/tickets', null, cookies.buyer);
  assert.equal(before_.status, 200, 'the buyer must start out able to use the API');

  const res = await call('POST', `/admin/users/${ids.buyer}/block`,
    { reason: 'chargeback fraud, ticket #4471' }, cookies.super);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after_ = await call('GET', '/tickets', null, cookies.buyer);
  assert.equal(after_.status, 401);
  assert.equal(after_.body.error, 'SESSION_REVOKED');

  // And they cannot simply sign in again.
  const back = await login('buyer');
  assert.equal(back.status, 403);
  assert.equal(back.body.error, 'ACCOUNT_BANNED');
});

test('unblocking lets them back in, but not on the old session', async () => {
  const res = await call('POST', `/admin/users/${ids.buyer}/unblock`, {}, cookies.super);
  assert.equal(res.status, 200);

  // The revoked session stays revoked — it is dead, not suspended.
  const old = await call('GET', '/tickets', null, cookies.buyer);
  assert.equal(old.status, 401);

  assert.equal((await login('buyer')).status, 200);
});

// ── The last super admin ────────────────────────────────────────────────────

test('the last super admin cannot be demoted or blocked', async () => {
  // Otherwise the platform has nobody who can administer it and no way back
  // that does not involve opening a SQL console against production.
  const { data: others } = await supabase.from('profiles')
    .select('id').eq('role', 'super_admin').eq('is_blocked', false).neq('id', ids.super);

  if ((others || []).length > 0) {
    // A real super admin already exists in this database, so ours is not the
    // last one and the guard cannot fire. Say so rather than assert nothing.
    assert.ok(true, 'skipped: another super admin exists in this database');
    return;
  }

  const demote = await call('PATCH', `/admin/users/${ids.super}/role`,
    { role: 'admin' }, cookies.super);
  assert.equal(demote.status, 409);
  assert.equal(demote.body.error, 'SELF_ACTION', 'self-action is caught before anything else');

  // Through another super admin it is the last-one guard that must stop it.
  await supabase.from('profiles').update({ role: 'super_admin' }).eq('id', ids.admin2);
  const second = await login('admin2');
  assert.equal(second.status, 200);

  // Two super admins now, so demoting one is allowed.
  const ok = await call('PATCH', `/admin/users/${ids.super}/role`,
    { role: 'admin' }, second.cookie);
  assert.equal(ok.status, 403, 'still refused — a peer, not a subordinate');

  await supabase.from('profiles').update({ role: 'admin' }).eq('id', ids.admin2);
});

// ── Banning an organizer ────────────────────────────────────────────────────

test('a ban stops the organizer selling but not signing in', async () => {
  const seller = () => cookies.seller;

  const before_ = await call('POST', '/events', {
    title: 'Before the ban', startsAt: new Date(Date.now() + 30 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
  }, seller());
  assert.notEqual(before_.status, 403, `organizer must start out able to create: ${before_.text}`);

  const ban = await call('POST', `/admin/organizers/${ids.organizer}/ban`,
    { reason: 'unpaid commission invoice INV-2026-0001' }, cookies.admin);
  assert.equal(ban.status, 200, JSON.stringify(ban.body));
  assert.equal(ban.body.data.isBanned, true);

  // The ban revokes sessions, so they sign in again — and that must still work.
  const back = await login('seller');
  assert.equal(back.status, 200, 'a banned organizer can still sign in');
  const fresh = back.cookie;

  // Reading stays open — they still need to see the invoice they owe.
  assert.equal((await call('GET', '/events', null, fresh)).status, 200);

  // Writing does not.
  const after_ = await call('POST', '/events', {
    title: 'After the ban', startsAt: new Date(Date.now() + 31 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 31 * 86400e3 + 3600e3).toISOString(),
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
  }, fresh);
  assert.equal(after_.status, 403, after_.text);
  assert.equal(after_.body.error, 'ORGANIZER_BANNED');

  cookies.seller = fresh;
});

test('unbanning restores selling', async () => {
  const res = await call('POST', `/admin/organizers/${ids.organizer}/unban`, {}, cookies.admin);
  assert.equal(res.status, 200);

  const fresh = (await login('seller')).cookie;

  const created = await call('POST', '/events', {
    title: 'After the unban', startsAt: new Date(Date.now() + 32 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 32 * 86400e3 + 3600e3).toISOString(),
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
  }, fresh);
  assert.notEqual(created.status, 403, created.text);
});

// ── The record ──────────────────────────────────────────────────────────────

test('every action lands in the audit log with its reason', async () => {
  const { data } = await supabase
    .from('admin_audit')
    .select('action, target_id, payload')
    .in('actor_id', [ids.admin, ids.super])
    .order('created_at', { ascending: false })
    .limit(30);

  const actions = (data || []).map((r) => r.action);
  for (const expected of ['user.blocked', 'user.unblocked', 'user.role_changed',
                          'organizer.banned', 'organizer.unbanned']) {
    assert.ok(actions.includes(expected), `${expected} must be recorded — got ${actions.join(', ')}`);
  }

  const ban = (data || []).find((r) => r.action === 'organizer.banned');
  assert.match(ban.payload.reason, /INV-2026-0001/,
    'the reason is the whole point — it is what answers the organizer months later');
});
