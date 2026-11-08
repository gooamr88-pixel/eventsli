const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const path = require('node:path');

// No database: the Supabase client is replaced before the service loads.
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase: {} } };
const appAuth = require('../services/appAuthService');

test('PKCE S256: the verifier matches its own challenge and nothing else', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(appAuth.challengeMatches(verifier, challenge), true);
  assert.equal(appAuth.challengeMatches(`${verifier}x`, challenge), false);
  assert.equal(appAuth.challengeMatches(verifier, `${challenge.slice(0, -1)}A`), false);
  assert.equal(appAuth.challengeMatches(verifier, ''), false);
  // "plain" PKCE — the verifier sent as its own challenge — is not accepted.
  assert.equal(appAuth.challengeMatches(verifier, verifier), false);
});

test('only the app may be sent a sign-in code', () => {
  delete process.env.CHECKIN_APP_REDIRECT_URIS;
  assert.equal(appAuth.isAllowedRedirect('eventsli-checkin://auth/callback'), true);
  assert.equal(appAuth.isAllowedRedirect('https://evil.example/callback'), false);
  assert.equal(appAuth.isAllowedRedirect('eventsli-checkin://auth/callback/../x'), false);
  assert.equal(appAuth.isAllowedRedirect(''), false);

  process.env.CHECKIN_APP_REDIRECT_URIS = 'eventsli-checkin-staging://auth/callback';
  assert.equal(appAuth.isAllowedRedirect('eventsli-checkin-staging://auth/callback'), true);
  assert.equal(appAuth.isAllowedRedirect('eventsli-checkin://auth/callback'), false);
  delete process.env.CHECKIN_APP_REDIRECT_URIS;
});
