const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gate-auth-test-secret-0123456789';
const gateAuth = require('../utils/gateAuth');
const scanTokens = require('../services/scanTokens');

/**
 * Where a door token travels (audit 2026-11-20): the app's Bearer header, or
 * the web gate's httpOnly cookie — and the cookie only with the gate header,
 * which a cross-site form or image cannot add.
 */

const token = scanTokens.signDeviceToken({ deviceId: '11111111-1111-4111-8111-111111111111', eventId: '22222222-2222-4222-8222-222222222222' });
const req = (headers = {}, cookies = {}, body = {}) => ({ headers, cookies, body });

test('the Bearer header is read first, as the app sends it', () => {
  assert.equal(gateAuth.tokenFrom(req({ authorization: `Bearer ${token}` })), token);
  assert.equal(gateAuth.tokenFrom(req({ authorization: 'Bearer ' })), null);
});

test('the gate cookie counts only with the gate header', () => {
  const cookies = { [gateAuth.GATE_COOKIE]: token };
  assert.equal(gateAuth.tokenFrom(req({}, cookies)), null, 'a cookie alone is what a cross-site request carries');
  assert.equal(gateAuth.tokenFrom(req({ [gateAuth.GATE_HEADER]: '0' }, cookies)), null);
  assert.equal(gateAuth.tokenFrom(req({ [gateAuth.GATE_HEADER]: '1' }, cookies)), token);
});

test('the unauthenticated limiter skips only a token this server signed', () => {
  assert.equal(gateAuth.hasSignedToken(req({ authorization: `Bearer ${token}` })), true);
  assert.equal(gateAuth.hasSignedToken(req()), false);
  assert.equal(gateAuth.hasSignedToken(req({ authorization: 'Bearer a.b.c' })), false);
  const forged = scanTokens.signDeviceToken({ deviceId: 'x', eventId: 'y' }, 'another-secret-0123456789abcdef');
  assert.equal(gateAuth.hasSignedToken(req({ authorization: `Bearer ${forged}` })), false);
});

test('a cookie sign-in sets an httpOnly, strict, scan-only cookie and leaves the token out of the answer', () => {
  const set = [];
  const res = { cookie: (...args) => set.push(args) };
  const result = { token, device: { id: 'd' } };
  const now = Date.parse('2026-11-20T10:00:00Z');
  const out = gateAuth.withGateSession(req({}, {}, { session: 'cookie' }), res, result, 3600e3, now);
  assert.equal(out.token, undefined);
  assert.deepEqual(out, { device: { id: 'd' }, session: 'cookie', expiresAt: '2026-11-20T11:00:00.000Z' });
  assert.equal(set.length, 1);
  const [name, value, opts] = set[0];
  assert.equal(name, 'eventsli_gate');
  assert.equal(value, token);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'strict');
  assert.equal(opts.path, '/api/v1/scan');
  assert.equal(opts.maxAge, 3600e3);

  // The app asks for nothing, and gets the token, with no cookie.
  const app = gateAuth.withGateSession(req(), { cookie: () => assert.fail('no cookie for the app') }, result, 3600e3);
  assert.equal(app.token, token);
});
