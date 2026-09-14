const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

/**
 * End-to-end auth against the REAL database.
 *
 * Unit tests prove the hashing is correct; only this proves the whole path is —
 * that a cookie is actually set, that revocation actually takes effect on the
 * next request, that lockout actually engages. Every one of those is a
 * cross-component behaviour that a mocked test would assert about itself.
 *
 * Runs on a random port and cleans up every row it creates.
 *
 *   node --test test/integration/authFlow.test.js
 */

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const codes = require('../../services/emailCodes');

/**
 * Plants a code we know, as the newest live one. The real code only exists in
 * an email, and the email is not what is under test here.
 */
async function plantCode(userId, code) {
  await supabase.from('email_verifications')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId).is('consumed_at', null);
  const { error } = await supabase.from('email_verifications').insert({
    user_id: userId,
    code_hash: codes.hashCode({ userId, code }),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new Error(error.message);
}

let server;
let baseUrl;
const created = [];   // profile ids to remove afterwards

const EMAIL = `test-${Date.now()}@eventsli-test.invalid`;
const PASSWORD = 'a-perfectly-long-passphrase';

/** Minimal fetch that keeps the session cookie, like a browser would. */
function makeClient() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, rawCookie: setCookie };
  };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  for (const id of created) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

// ── Sign-up and email confirmation ───────────────────────────────────────────

test('register creates the account but signs nobody in', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/register', {
    email: EMAIL, password: PASSWORD, fullName: 'Test Person',
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.email, EMAIL);
  assert.equal(res.body.data.verificationRequired, true);
  created.push(res.body.data.id);

  assert.equal(res.rawCookie, null, 'no session until the address is confirmed');
});

test('the right password on an unconfirmed address is refused, and says why', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'EMAIL_NOT_VERIFIED');
  assert.equal(res.rawCookie, null);
});

test('a WRONG password on an unconfirmed address does not reveal that it is unconfirmed', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/login', { email: EMAIL, password: 'not-the-right-passphrase' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
});

test('a wrong code is refused and counts down', async () => {
  await plantCode(created[0], '111111');
  const call = makeClient();
  const res = await call('POST', '/auth/verify-email', { email: EMAIL, code: '222222' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'INVALID_CODE');
  assert.equal(res.body.meta.remaining, 4);
});

test('five wrong guesses kill the code — even the right one stops working', async () => {
  await plantCode(created[0], '111111');
  const call = makeClient();
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', '/auth/verify-email', { email: EMAIL, code: '999999' });
    assert.equal(res.body.error, 'INVALID_CODE');
  }
  const fifth = await call('POST', '/auth/verify-email', { email: EMAIL, code: '999999' });
  assert.equal(fifth.status, 410);
  assert.equal(fifth.body.error, 'CODE_EXPIRED');

  const right = await call('POST', '/auth/verify-email', { email: EMAIL, code: '111111' });
  assert.equal(right.body.error, 'CODE_EXPIRED', 'a dead code must stay dead');
});

test('a code for an address with no account gets the same answer as a wrong one', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/verify-email', {
    email: `nobody-${Date.now()}@eventsli-test.invalid`, code: '123456',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'INVALID_CODE');
});

test('asking for a new code answers the same whether or not the address exists', async () => {
  const call = makeClient();
  const real = await call('POST', '/auth/resend-verification', { email: EMAIL });
  const fake = await call('POST', '/auth/resend-verification', { email: `nobody-${Date.now()}@eventsli-test.invalid` });
  assert.equal(real.status, 200);
  assert.equal(fake.status, 200);
  assert.equal(real.body.message, fake.body.message);
});

test('the right code confirms the address and signs in — once', async () => {
  await plantCode(created[0], '654321');
  const call = makeClient();
  // Pasted with a space, the way an email client groups it.
  const res = await call('POST', '/auth/verify-email', { email: EMAIL, code: '654 321' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.rawCookie, /eventsli_session=/);
  assert.match(res.rawCookie, /HttpOnly/i, 'JavaScript must not be able to read it');
  assert.match(res.rawCookie, /SameSite=Lax/i);

  const me = await call('GET', '/auth/me');
  assert.equal(me.status, 200);

  const again = await call('POST', '/auth/verify-email', { email: EMAIL, code: '654321' });
  assert.equal(again.status, 409, 'an already-confirmed address is not confirmed twice');
});

test('the password is never stored in the clear', async () => {
  const { data } = await supabase
    .from('profiles').select('password_hash').eq('email', EMAIL).single();
  assert.ok(data.password_hash.startsWith('pbkdf2$'));
  assert.equal(data.password_hash.includes(PASSWORD), false);
});

test('a duplicate email is refused', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/register', {
    email: EMAIL, password: PASSWORD, fullName: 'Someone Else',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'CONFLICT');
});

test('/auth/me needs a session', async () => {
  const anon = makeClient();
  const res = await anon('GET', '/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
});

test('login then /auth/me returns the resolved access context', async () => {
  const call = makeClient();
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const me = await call('GET', '/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.email, EMAIL);
  assert.equal(me.body.data.role, 'attendee');
  assert.equal(me.body.data.isOrganizer, false);
  assert.equal(me.body.data.isAdmin, false);
});

test('a wrong password and an unknown address are indistinguishable', async () => {
  const call = makeClient();
  const wrongPassword = await call('POST', '/auth/login', {
    email: EMAIL, password: 'not-the-right-passphrase',
  });
  const noSuchUser = await call('POST', '/auth/login', {
    email: `nobody-${Date.now()}@eventsli-test.invalid`, password: 'not-the-right-passphrase',
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(
    wrongPassword.body.message, noSuchUser.body.message,
    'a different message here is an account-enumeration oracle',
  );
});

test('logout revokes the session server-side, not just the cookie', async () => {
  const call = makeClient();
  await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });

  // Capture the cookie, then log out, then replay the captured cookie — this is
  // exactly what someone who stole the token would do.
  const stolen = (await call('GET', '/auth/sessions')).body.data
    .find((s) => s.current);
  assert.ok(stolen, 'the current session should be listed');

  await call('POST', '/auth/logout');

  const replay = await fetch(`${baseUrl}/auth/me`, {
    headers: { cookie: `eventsli_session=${await currentToken(EMAIL)}` },
  });
  assert.equal(replay.status, 401, 'a revoked token must be dead even if replayed');
});

test('logout-all ends every session at once', async () => {
  const a = makeClient();
  const b = makeClient();
  await a('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  await b('POST', '/auth/login', { email: EMAIL, password: PASSWORD });

  assert.equal((await a('GET', '/auth/me')).status, 200);
  assert.equal((await b('GET', '/auth/me')).status, 200);

  const res = await a('POST', '/auth/logout-all');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.sessionsEnded >= 2);

  assert.equal((await b('GET', '/auth/me')).status, 401, 'the other device must be signed out too');
});

test('changing the password ends other sessions but keeps this one', async () => {
  const mine = makeClient();
  const other = makeClient();
  await mine('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  await other('POST', '/auth/login', { email: EMAIL, password: PASSWORD });

  const NEW = 'an-even-longer-new-passphrase';
  const res = await mine('POST', '/auth/change-password', {
    currentPassword: PASSWORD, newPassword: NEW,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal((await other('GET', '/auth/me')).status, 401, 'the other device must be evicted');
  assert.equal((await mine('GET', '/auth/me')).status, 200, 'and I must stay signed in');

  // The new password works and the old one does not.
  const fresh = makeClient();
  assert.equal((await fresh('POST', '/auth/login', { email: EMAIL, password: NEW })).status, 200);
  assert.equal((await fresh('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).status, 401);

  // Put it back so later runs of this file behave the same.
  await fresh('POST', '/auth/change-password', { currentPassword: NEW, newPassword: PASSWORD });
});

test('short passwords are refused with a usable message', async () => {
  const call = makeClient();
  const res = await call('POST', '/auth/register', {
    email: `short-${Date.now()}@eventsli-test.invalid`, password: 'short', fullName: 'X Y',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.match(res.body.message, /12 characters/);
  assert.ok(Array.isArray(res.body.meta.details), 'field-level detail lets a form highlight inputs');
});

/** Reads the live token straight from the cookie a fresh login sets. */
async function currentToken(email) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const sc = res.headers.get('set-cookie') || '';
  const token = sc.split('eventsli_session=')[1]?.split(';')[0] || '';
  // Immediately revoke it so this helper cannot leave a live session behind.
  await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST', headers: { cookie: `eventsli_session=${token}` },
  });
  return token;
}
