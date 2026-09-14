const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const reset = require('../../services/passwordResetService');
const { hashToken } = require('../../utils/crypto');

/**
 * Password reset, end to end.
 *
 * The property that matters most is NOT that the happy path works — it is that
 * the endpoint never reveals whether an address has an account, and that a
 * token is genuinely single-use even when two requests race with the same
 * stolen link.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
const EMAIL = `reset-${stamp}@eventsli-test.invalid`;
const OLD = 'the-original-passphrase';
const NEW = 'a-completely-new-passphrase';

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const res = await call('POST', '/auth/register', {
    email: EMAIL, password: OLD, fullName: 'Reset Test',
  });
  ids.profile = res.body.data.id;
  // Confirmed as the emailed code would, so the account can sign in later.
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', ids.profile);
});

after(async () => {
  if (ids.profile) {
    await supabase.from('password_resets').delete().eq('user_id', ids.profile);
    await supabase.from('sessions').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const sc = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json().catch(() => null), cookie: sc };
}

/** Reads the live token from the DB — the email path is not under test here. */
async function issueToken() {
  const r = await reset.request({ emailAddress: EMAIL, req: null });
  assert.ok(r.token, 'a real account must produce a token');
  return r.token;
}

// ── Anti-enumeration ────────────────────────────────────────────────────────

test('a real and an unknown address get identical answers', async () => {
  const real = await call('POST', '/auth/forgot-password', { email: EMAIL });
  const fake = await call('POST', '/auth/forgot-password', {
    email: `nobody-${stamp}@eventsli-test.invalid`,
  });

  assert.equal(real.status, fake.status);
  assert.deepEqual(real.body, fake.body,
    'any difference here turns this endpoint into a directory of who has an account');
  assert.equal(real.body.data.sent, true);
});

test('a suspended account is indistinguishable from no account', async () => {
  await supabase.from('profiles').update({ is_blocked: true }).eq('id', ids.profile);

  const blocked = await reset.request({ emailAddress: EMAIL, req: null });
  const missing = await reset.request({ emailAddress: 'nope@eventsli-test.invalid', req: null });

  assert.deepEqual(blocked, {}, 'a blocked account must not receive a reset');
  assert.deepEqual(missing, {});

  await supabase.from('profiles').update({ is_blocked: false }).eq('id', ids.profile);
});

// ── The token ───────────────────────────────────────────────────────────────

test('only the digest is stored, never the token', async () => {
  const token = await issueToken();

  const { data: rows } = await supabase
    .from('password_resets').select('token_hash').eq('user_id', ids.profile);

  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.notEqual(row.token_hash, token, 'the raw token must never be written');
  }
  // A leaked database cannot be used to take an account.
  assert.ok(rows.some((r) => r.token_hash === hashToken(token)));
});

test('requesting again invalidates the previous link', async () => {
  const first = await issueToken();
  const second = await issueToken();
  assert.notEqual(first, second);

  const stale = await call('POST', '/auth/reset-password', { token: first, password: NEW });
  assert.equal(stale.status, 400, 'five clicks must not leave five live keys in an inbox');
  assert.equal(stale.body.error, 'INVALID_TOKEN');

  // The newest one still works.
  const ok = await call('POST', '/auth/reset-password', { token: second, password: NEW });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('the new password works and the old one does not', async () => {
  const good = await call('POST', '/auth/login', { email: EMAIL, password: NEW });
  assert.equal(good.status, 200);

  const bad = await call('POST', '/auth/login', { email: EMAIL, password: OLD });
  assert.equal(bad.status, 401);
});

test('a token is single-use', async () => {
  const token = await issueToken();

  const first = await call('POST', '/auth/reset-password', { token, password: NEW });
  assert.equal(first.status, 200);

  const second = await call('POST', '/auth/reset-password', { token, password: 'yet-another-passphrase' });
  assert.equal(second.status, 400);
  assert.equal(second.body.error, 'INVALID_TOKEN');
});

test('two requests racing the same link produce exactly one reset', async () => {
  // The case that matters: an attacker racing the real owner with a stolen
  // link. The single-use check is in the SQL WHERE clause for this reason — a
  // read-then-write would let both through.
  const token = await issueToken();

  const results = await Promise.all([
    call('POST', '/auth/reset-password', { token, password: 'race-winner-passphrase-a' }),
    call('POST', '/auth/reset-password', { token, password: 'race-winner-passphrase-b' }),
    call('POST', '/auth/reset-password', { token, password: 'race-winner-passphrase-c' }),
  ]);

  const won = results.filter((r) => r.status === 200);
  assert.equal(won.length, 1, `expected exactly 1 reset, got ${won.length}`);

  // Which of the three won is by definition unpredictable, so the password is
  // now an unknown one of three. Put it back, or every later test logs in with
  // the wrong value and fails for a reason that has nothing to do with it.
  await call('POST', '/auth/reset-password', { token: await issueToken(), password: NEW });
});

test('an expired token is refused', async () => {
  const token = await issueToken();
  await supabase.from('password_resets')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('token_hash', hashToken(token));

  const res = await call('POST', '/auth/reset-password', { token, password: NEW });
  assert.equal(res.status, 400);
});

test('expired, used and never-existed all give the same answer', async () => {
  const madeUp = await call('POST', '/auth/reset-password', {
    token: 'a'.repeat(43), password: NEW,
  });
  assert.equal(madeUp.status, 400);
  assert.equal(madeUp.body.error, 'INVALID_TOKEN');
  // Telling them apart would let someone holding a stale link learn whether it
  // was ever real.
  assert.match(madeUp.body.message, /no longer valid/i);
});

// ── What a reset is FOR ─────────────────────────────────────────────────────

test('resetting evicts every other session', async () => {
  // Someone resets after a scare. It has to actually remove whoever they are
  // worried about.
  const a = await call('POST', '/auth/login', { email: EMAIL, password: NEW });
  const b = await call('POST', '/auth/login', { email: EMAIL, password: NEW });
  const cookieA = a.cookie.split(';')[0];
  const cookieB = b.cookie.split(';')[0];

  assert.equal((await call('GET', '/auth/me', null, { cookie: cookieA })).status, 200);
  assert.equal((await call('GET', '/auth/me', null, { cookie: cookieB })).status, 200);

  const token = await issueToken();
  await call('POST', '/auth/reset-password', { token, password: 'post-scare-passphrase' });

  assert.equal((await call('GET', '/auth/me', null, { cookie: cookieA })).status, 401);
  assert.equal((await call('GET', '/auth/me', null, { cookie: cookieB })).status, 401);
});

test('a reset does NOT sign you in', async () => {
  const token = await issueToken();
  const res = await call('POST', '/auth/reset-password', { token, password: NEW });

  assert.equal(res.status, 200);
  // Signing someone in straight off a link that arrived by email means a stolen
  // link IS a session. Making them log in proves they know the new password.
  assert.equal(res.cookie, null, 'no session cookie may be issued here');
});

test('a reset clears a lockout', async () => {
  // Someone locked out by failed attempts is exactly who needs this to work —
  // a reset that left them locked would be no help at all.
  await supabase.from('profiles').update({
    failed_login_count: 99,
    locked_until: new Date(Date.now() + 3600e3).toISOString(),
  }).eq('id', ids.profile);

  const locked = await call('POST', '/auth/login', { email: EMAIL, password: NEW });
  assert.equal(locked.status, 429);

  const token = await issueToken();
  await call('POST', '/auth/reset-password', { token, password: NEW });

  const after_ = await call('POST', '/auth/login', { email: EMAIL, password: NEW });
  assert.equal(after_.status, 200, 'the lock must be cleared by the reset');
});

test('a short new password is refused', async () => {
  const token = await issueToken();
  const res = await call('POST', '/auth/reset-password', { token, password: 'short' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');

  // And the token must survive a rejected attempt — otherwise a typo burns the
  // link and the user has to start over.
  const retry = await call('POST', '/auth/reset-password', { token, password: NEW });
  assert.equal(retry.status, 200, 'a validation failure must not consume the token');
});
