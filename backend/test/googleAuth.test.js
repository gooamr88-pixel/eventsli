const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Google sign-in — the checks that decide whether it is safe.
 *
 * `verifyIdToken` reaches Google, so the network call is stubbed. What is under
 * test is what happens to the CLAIMS afterwards: a valid Google token minted
 * for a different app, or for an unverified address, must not sign anyone in.
 * Those are the two ways this goes wrong, and neither involves a bad signature.
 */

const ORIGINAL_FETCH = global.fetch;
const CLIENT_ID = '652713460612-test.apps.googleusercontent.com';

function withGoogleReply(payload, { ok = true } = {}) {
  global.fetch = async () => ({ ok, json: async () => payload });
}
function restore() { global.fetch = ORIGINAL_FETCH; }

function load() {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  // No supabase import at module load, so this is exercisable with no database.
  delete require.cache[require.resolve('../services/googleTokens')];
  return require('../services/googleTokens');
}

const validPayload = {
  aud: CLIENT_ID,
  iss: 'https://accounts.google.com',
  email: 'Someone@Example.com',
  email_verified: 'true',
  name: 'Some One',
  sub: '1234567890',
};

test('a valid token yields a normalised identity', async () => {
  const google = load();
  withGoogleReply(validPayload);
  try {
    const id = await google.verifyIdToken('a-token');
    // Lower-cased, because accounts are keyed on the address and
    // Someone@Example.com is the same person as someone@example.com.
    assert.equal(id.email, 'someone@example.com');
    assert.equal(id.name, 'Some One');
    assert.equal(id.googleId, '1234567890');
  } finally { restore(); }
});

test('a token minted for ANOTHER app is refused', async () => {
  // The one that matters most. A token from a different Google client is a
  // perfectly valid Google token — without the `aud` check, any developer with
  // a Google client could sign in here as anyone.
  const google = load();
  withGoogleReply({ ...validPayload, aud: 'someone-elses-client.apps.googleusercontent.com' });
  try {
    await assert.rejects(() => google.verifyIdToken('a-token'), (e) => e.code === 'INVALID_TOKEN');
  } finally { restore(); }
});

test('an unverified Google address is refused', async () => {
  // Accounts are matched BY EMAIL, so an unverified address would let someone
  // claim an address they do not own and walk into the password account that
  // already uses it.
  const google = load();
  withGoogleReply({ ...validPayload, email_verified: false });
  try {
    await assert.rejects(() => google.verifyIdToken('a-token'), (e) => e.code === 'INVALID_TOKEN');
  } finally { restore(); }
});

test('a token from the wrong issuer is refused', async () => {
  const google = load();
  withGoogleReply({ ...validPayload, iss: 'https://evil.example.com' });
  try {
    await assert.rejects(() => google.verifyIdToken('a-token'), (e) => e.code === 'INVALID_TOKEN');
  } finally { restore(); }
});

test('a token with no email is refused', async () => {
  const google = load();
  withGoogleReply({ ...validPayload, email: undefined });
  try {
    await assert.rejects(() => google.verifyIdToken('a-token'), (e) => e.code === 'INVALID_TOKEN');
  } finally { restore(); }
});

test('a rejected token yields no detail', async () => {
  const google = load();
  withGoogleReply({ error: 'invalid_token' }, { ok: false });
  try {
    await assert.rejects(
      () => google.verifyIdToken('a-token'),
      (e) => e.code === 'INVALID_TOKEN' && !/tokeninfo|401|Google said/.test(e.message),
    );
  } finally { restore(); }
});

test('email_verified accepts both the boolean and the string', async () => {
  // tokeninfo returns strings; a locally-verified JWT returns a boolean. Both
  // are the same fact and both must work.
  const google = load();
  for (const value of [true, 'true']) {
    withGoogleReply({ ...validPayload, email_verified: value });
    // eslint-disable-next-line no-await-in-loop
    const id = await google.verifyIdToken('a-token');
    assert.equal(id.email, 'someone@example.com');
  }
  restore();
});

test('without a client id, sign-in is unavailable rather than unguarded', () => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete require.cache[require.resolve('../services/googleTokens')];
  const google = require('../services/googleTokens');

  assert.equal(google.configured(), false);
  // Not "accept anything": an unset client id must close the door, because with
  // no `aud` to compare against every token would pass.
  assert.rejects(() => google.verifyIdToken('x'), (e) => e.code === 'FEATURE_DISABLED');

  process.env.GOOGLE_CLIENT_ID = saved;
});
