const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGateScanRequest } = require('../utils/gateRoutes');

const req = (originalUrl) => ({ originalUrl });

test('the four door requests are recognised', () => {
  for (const path of ['verify', 'sync', 'undo', 'status']) {
    assert.equal(isGateScanRequest(req(`/api/v1/scan/${path}`)), true, path);
  }
});

test('a query string or trailing slash does not change the answer', () => {
  assert.equal(isGateScanRequest(req('/api/v1/scan/status?since=123')), true);
  assert.equal(isGateScanRequest(req('/api/v1/scan/verify/')), true);
});

test('sign-in and door-team routes stay under the per-IP ceiling', () => {
  // These are where a PIN or a password is guessed; exempting them would
  // remove the only limit an attacker meets.
  assert.equal(isGateScanRequest(req('/api/v1/scan/login')), false);
  assert.equal(isGateScanRequest(req('/api/v1/scan/staff-login')), false);
  assert.equal(isGateScanRequest(req('/api/v1/scan/assignments')), false);
});

test('look-alike paths are not exempt', () => {
  assert.equal(isGateScanRequest(req('/api/v1/scan/verifyX')), false);
  assert.equal(isGateScanRequest(req('/api/v1/scan')), false);
  assert.equal(isGateScanRequest(req('/api/v1/events/abc/scan/verify')), false);
  assert.equal(isGateScanRequest(req('/api/v2/scan/verify')), false);
  assert.equal(isGateScanRequest(req('')), false);
  assert.equal(isGateScanRequest(undefined), false);
});

test('the check-in app reads its own door under the device budget, not the IP ceiling', () => {
  for (const path of ['me', 'recent', 'attendees', 'manual-check-in', 'analytics', 'manifest', 'keys']) {
    assert.equal(isGateScanRequest(req(`/api/v1/scan/${path}`)), true, path);
  }
  assert.equal(
    isGateScanRequest(req('/api/v1/scan/tickets/3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8')), true,
  );
});

test('a ticket path is exactly one id, nothing more', () => {
  assert.equal(isGateScanRequest(req('/api/v1/scan/tickets/not-an-id')), false);
  assert.equal(isGateScanRequest(req('/api/v1/scan/tickets')), false);
  assert.equal(
    isGateScanRequest(req('/api/v1/scan/tickets/3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8/extra')), false,
  );
});
