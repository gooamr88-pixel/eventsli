const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The two lookups every authenticated request makes, and what each answers
 * when the DATABASE fails rather than when the account is gone.
 *
 * Both used to collapse a failure into a real-looking answer:
 *
 *   sessionService.isValid   a lookup error was `false` — "revoked" — so the
 *                            middleware cleared the cookie and signed them out.
 *   rbacService              the organizer query's error was never read, so a
 *                            failure was "no organizer profile", cached 10s.
 *
 * The Supabase client is replaced with a stub before either module loads, so
 * this runs with no database and no credentials.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

// One answer per table, swapped per test. `throw` makes the query reject.
const answers = {};
function query(table) {
  const result = () => {
    const a = answers[table];
    if (a === 'throw') return Promise.reject(new Error('socket hang up'));
    return Promise.resolve(a || { data: null, error: null });
  };
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, gt: () => chain, order: () => chain,
    maybeSingle: result,
    then: (ok, ko) => result().then(ok, ko),
  };
  return chain;
}
stub('config/supabase.js', { supabase: { from: query } });

const sessions = require('../services/sessionService');
const rbac = require('../services/rbacService');

const decoded = { sub: '22222222-2222-4222-8222-222222222222', jti: 'jti-under-test' };
const later = new Date(Date.now() + 3600e3).toISOString();

// ── sessionService.check ─────────────────────────────────────────────────────

test('a live session is live', async () => {
  answers.sessions = { data: { revoked_at: null, expires_at: later }, error: null };
  assert.equal(await sessions.check(decoded), 'live');
  assert.equal(await sessions.isValid(decoded), true);
});

test('a revoked, expired or missing session has ended', async () => {
  answers.sessions = { data: { revoked_at: new Date().toISOString(), expires_at: later }, error: null };
  assert.equal(await sessions.check(decoded), 'ended');
  answers.sessions = { data: { revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null };
  assert.equal(await sessions.check(decoded), 'ended');
  answers.sessions = { data: null, error: null };
  assert.equal(await sessions.check(decoded), 'ended');
  assert.equal(await sessions.check({ sub: decoded.sub }), 'ended', 'no jti is never accepted');
});

test('REGRESSION: a failed session lookup is unknown, not ended', async () => {
  answers.sessions = { data: null, error: { message: 'canceling statement due to statement timeout' } };
  assert.equal(await sessions.check(decoded), 'unknown');
  answers.sessions = 'throw';
  assert.equal(await sessions.check(decoded), 'unknown');
  // Still a refusal for anything that only asks "is it live?".
  assert.equal(await sessions.isValid(decoded), false);
});

// ── rbacService.getAccessContext ─────────────────────────────────────────────

const PROFILE = {
  data: { id: decoded.sub, email: 'o@example.test', full_name: 'O', role: 'organizer', is_blocked: false, account_types: ['organizer'] },
  error: null,
};
const ORGANIZER = {
  data: { id: '33333333-3333-4333-8333-333333333333', display_name: 'O Co', country: 'CA', is_banned: false },
  error: null,
};

test('REGRESSION: a failed organizer lookup throws, and is not cached as "not an organizer"', async () => {
  rbac.invalidate(decoded.sub);
  answers.profiles = PROFILE;
  answers.organizers = { data: null, error: { message: 'connection terminated unexpectedly' } };

  await assert.rejects(() => rbac.getAccessContext(decoded.sub), /access lookup failed/);

  // The very next request, after the blip, must see the organizer — nothing
  // from the failed attempt may have been remembered.
  answers.organizers = ORGANIZER;
  const access = await rbac.getAccessContext(decoded.sub);
  assert.equal(access.isOrganizer, true);
  assert.equal(access.organizerId, ORGANIZER.data.id);
});

test('an account with no organizer profile is simply not an organizer', async () => {
  rbac.invalidate(decoded.sub);
  answers.profiles = PROFILE;
  answers.organizers = { data: null, error: null };
  const access = await rbac.getAccessContext(decoded.sub);
  assert.equal(access.isOrganizer, false);
  assert.equal(access.organizerId, null);
});

test('a failed profile lookup still throws', async () => {
  rbac.invalidate(decoded.sub);
  answers.profiles = { data: null, error: { message: 'timeout' } };
  answers.organizers = ORGANIZER;
  await assert.rejects(() => rbac.getAccessContext(decoded.sub), /access lookup failed/);
});
