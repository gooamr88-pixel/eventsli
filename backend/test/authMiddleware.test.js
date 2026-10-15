const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

/**
 * `requireAuth` must ANSWER when the access lookup fails.
 *
 * It awaited `getAccessContext`, which throws on a database error, with no
 * try/catch. Express 4 does not catch a rejected promise from async middleware,
 * so the request never got a response — on every authenticated route — until
 * the client gave up.
 *
 * The middleware's database-touching dependencies are replaced before it is
 * loaded, so this runs with no credentials (node --test runs each file in its
 * own process, so the replacements stay in this file).
 */
process.env.JWT_SECRET = 'unit-test-only-secret-for-the-auth-middleware';

const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let lookup = 'ok';
let session = 'live';          // what sessions.check answers
let cookieCleared = false;
stub('config/supabase.js', { supabase: {} });
stub('services/sessionService.js', {
  COOKIE_NAME: 'es_session',
  check: async () => session,
  isValid: async () => session === 'live',
  clearCookie() { cookieCleared = true; },
  touch() {},
});
stub('services/rbacService.js', {
  hasRole: () => true,
  getAccessContext: async (userId) => {
    if (lookup === 'throw') throw new Error('access lookup failed: connection reset');
    return { userId, email: 'someone@example.test', role: 'organizer', isBlocked: false };
  },
});

const { requireAuth } = require('../middleware/auth');

const token = jwt.sign(
  { sub: '11111111-1111-4111-8111-111111111111', jti: 'unit-test-jti' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' },
);

async function run() {
  cookieCleared = false;
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const res = {
    statusCode: null,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('a working lookup lets the request through', async () => {
  lookup = 'ok';
  const { req, res, nextCalled } = await run();
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null, 'nothing was written to the response');
  assert.equal(req.user.role, 'organizer');
});

test('a failed lookup answers, and answers no', async () => {
  lookup = 'throw';
  const { req, res, nextCalled } = await run();
  assert.equal(nextCalled, false, 'the request does not proceed without knowing who it is');
  assert.equal(req.user, undefined);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'INTERNAL_ERROR');
  assert.equal(res.body.success, false);
  lookup = 'ok';
});

/**
 * REGRESSION — the session lookup failing signed people out.
 *
 * `isValid` answered `false` for a database error, the same as for a revoked
 * session, so requireAuth cleared the cookie and answered 401. Every account
 * that made a request during a blip was signed out, and the client hid the
 * admin console and the organizer's data with it.
 */
test('a session that cannot be checked is refused, but the cookie stays', async () => {
  session = 'unknown';
  const { req, res, nextCalled } = await run();
  assert.equal(nextCalled, false, 'nothing proceeds on a session nobody could confirm');
  assert.equal(req.user, undefined);
  assert.equal(res.statusCode, 503, 'a retryable answer, not a 401');
  assert.equal(res.body.error, 'SESSION_CHECK_FAILED');
  assert.equal(cookieCleared, false, 'a lookup failure is not a sign-out');
  session = 'live';
});

test('a session that has ended is a 401, and the cookie goes', async () => {
  session = 'ended';
  const { res, nextCalled } = await run();
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'SESSION_REVOKED');
  assert.equal(cookieCleared, true);
  session = 'live';
});
