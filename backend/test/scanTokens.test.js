const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const t = require('../services/scanTokens');

/**
 * The gate accepts two credentials and nothing else. These are the claim rules
 * that keep a session cookie, a forged token or a mismatched principal out.
 */

const SECRET = 'a-test-secret-long-enough-to-mean-something-0123456789';

test('a device token reads back as a device, with no person on it', () => {
  const token = t.signDeviceToken({ deviceId: 'd1', eventId: 'e1' }, SECRET);
  assert.deepEqual(t.verifyScanToken(token, SECRET), { deviceId: 'd1', eventId: 'e1', staffUserId: null });
});

test('a staff token carries the person as well as the event', () => {
  const token = t.signStaffToken({ deviceId: 'd2', eventId: 'e2', userId: 'u2' }, SECRET);
  assert.deepEqual(t.verifyScanToken(token, SECRET), { deviceId: 'd2', eventId: 'e2', staffUserId: 'u2' });
});

test('a session-shaped token is not a gate credential', () => {
  // Signed with the same secret: the `typ` claim is the only thing keeping it out.
  const session = jwt.sign({ sub: 'u1', jti: 'j1', role: 'admin' }, SECRET, { algorithm: 'HS256' });
  assert.equal(t.verifyScanToken(session, SECRET), null);
});

test('a staff token without its person is refused', () => {
  const partial = jwt.sign({ typ: t.STAFF_TOKEN_TYPE, did: 'd', eid: 'e' }, SECRET, { algorithm: 'HS256' });
  assert.equal(t.verifyScanToken(partial, SECRET), null);
});

test('a token signed with another secret is refused', () => {
  const token = t.signDeviceToken({ deviceId: 'd', eventId: 'e' }, 'some-other-secret-entirely-000000000');
  assert.equal(t.verifyScanToken(token, SECRET), null);
});

test('an unsigned token is refused', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ typ: t.DEVICE_TOKEN_TYPE, did: 'd', eid: 'e' })).toString('base64url');
  assert.equal(t.verifyScanToken(`${header}.${body}.`, SECRET), null);
});

test('no secret configured means no token verifies', () => {
  const token = t.signDeviceToken({ deviceId: 'd', eventId: 'e' }, SECRET);
  assert.equal(t.verifyScanToken(token, ''), null);
});

test('a person\'s credential lasts a shift, a tablet\'s a weekend', () => {
  const staff = jwt.decode(t.signStaffToken({ deviceId: 'd', eventId: 'e', userId: 'u' }, SECRET));
  const device = jwt.decode(t.signDeviceToken({ deviceId: 'd', eventId: 'e' }, SECRET));
  assert.ok(staff.exp - staff.iat <= 16 * 3600, 'a staff token must not outlive a shift');
  assert.ok(device.exp - device.iat <= 7 * 86400);
  assert.ok(staff.exp - staff.iat < device.exp - device.iat);
});
