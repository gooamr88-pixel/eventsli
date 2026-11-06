const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Google sign-in confirming an account somebody else registered.
 *
 * REGRESSION (TECH-AUDIT-LOG T-013): an attacker registers victim@company.com
 * with their own password; the account stays unconfirmed. The victim later
 * signs in with Google, which used to mark the address confirmed and KEEP the
 * attacker's password — who then signed in as the victim. The unproven
 * password, the outstanding codes and any session must all go.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let profile;
const writes = [];
const revoked = [];

function table(name) {
  let patch = null;
  const chain = {
    select: () => chain,
    update: (p) => { patch = p; return chain; },
    insert: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: profile ? { ...profile } : null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (ok, ko) => {
      if (patch) writes.push({ table: name, patch });
      if (patch && name === 'profiles') Object.assign(profile, patch);
      return Promise.resolve({ data: null, error: null }).then(ok, ko);
    },
  };
  return chain;
}
stub('config/supabase.js', { supabase: { from: table } });
stub('services/sessionService.js', { revokeAllForUser: async (id, reason) => { revoked.push({ id, reason }); } });

const google = require('../services/googleAuthService');

beforeEach(() => {
  writes.length = 0; revoked.length = 0;
  profile = {
    id: 'u1', email: 'victim@company.test', role: 'attendee', is_blocked: false,
    email_verified_at: null, password_hash: 'pbkdf2$attacker-chosen',
  };
});

test('REGRESSION T-013: confirming an unverified account by Google removes the unproven password', async () => {
  const { user, created } = await google.findOrCreate({ email: 'victim@company.test', name: 'V' });
  assert.equal(created, false);
  assert.equal(user.id, 'u1');
  assert.equal(profile.password_hash, null, 'the registrant\'s password no longer signs in');
  assert.ok(profile.email_verified_at, 'the address is confirmed');
});

test('outstanding codes and links are spent, and every session is ended', async () => {
  await google.findOrCreate({ email: 'victim@company.test', name: 'V' });
  const spent = writes.find((w) => w.table === 'email_verifications');
  assert.ok(spent && spent.patch.consumed_at, 'live codes consumed');
  assert.deepEqual(revoked, [{ id: 'u1', reason: 'google_claimed_unverified' }]);
});

test('an already-confirmed account keeps its password — it was proven by the inbox', async () => {
  profile.email_verified_at = '2026-10-01T00:00:00Z';
  await google.findOrCreate({ email: 'victim@company.test', name: 'V' });
  assert.equal(profile.password_hash, 'pbkdf2$attacker-chosen');
  assert.equal(writes.length, 0);
  assert.equal(revoked.length, 0);
});

test('a suspended account is refused before anything changes', async () => {
  profile.is_blocked = true;
  await assert.rejects(google.findOrCreate({ email: 'victim@company.test', name: 'V' }), (e) => e.code === 'ACCOUNT_BANNED');
  assert.equal(writes.length, 0);
});
