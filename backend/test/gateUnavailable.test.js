const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * A door under a rush the database cannot keep up with.
 *
 * Found by scripts/load-gate.js at three times the target rate: a device
 * lookup that FAILED was answered like a device that had been switched off
 * (401), which the app reads as "this door was closed" and leaves, and a scan
 * the database never answered came back as a 200 "error", which both clients
 * showed as settled. Both are now retryable 503s: refused, never let in on a
 * non-answer, and the phone holds the scan or decides it from its offline list.
 */

const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, '..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const DEVICE_LOOKUP_FAILED = Object.freeze({ lookupFailed: true });
const state = { device: null, session: 'live', scan: null };
stub('config/supabase.js', { supabase: {} });
stub('services/scanService.js', {
  DEVICE_LOOKUP_FAILED,
  verifyDeviceToken: () => ({ deviceId: 'd1', eventId: 'e1', staffUserId: null, sessionId: null }),
  getActiveDevice: async () => state.device,
  scan: async () => state.scan,
});
stub('services/sessionService.js', { check: async () => state.session });

const { requireDevice } = require('../middleware/deviceAuth');
const scanController = require('../controllers/scanController');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler(req, res, () => resolve({ status: 'next', body: req.device }));
  });
}

const authed = () => ({ headers: { authorization: 'Bearer a.b.c' } });

test('a device lookup that failed is a retryable 503, not "switched off"', async () => {
  state.device = DEVICE_LOOKUP_FAILED;
  const r = await call(requireDevice, authed());
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'SESSION_CHECK_FAILED');
});

test('a device that is really switched off is still a 401', async () => {
  state.device = null;
  const r = await call(requireDevice, authed());
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'SESSION_REVOKED');
});

test('a device that checks out goes through', async () => {
  state.device = { id: 'd1', eventId: 'e1', staffUserId: null, role: 'pin', label: 'North' };
  const r = await call(requireDevice, authed());
  assert.equal(r.status, 'next');
  assert.equal(r.body.deviceId, 'd1');
});

test('a scan the database did not answer is a 503, never a 200 "error"', async () => {
  state.scan = { ok: false, result: 'error', message: 'fetch failed', unavailable: true };
  const r = await call(scanController.verify, { body: { qr: 'x' }, device: { deviceId: 'd1', eventId: 'e1' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'SCAN_UNAVAILABLE');
});

test('a decided refusal is still a 200 answer', async () => {
  state.scan = { ok: false, result: 'duplicate', message: 'Already scanned' };
  const r = await call(scanController.verify, { body: { qr: 'x' }, device: { deviceId: 'd1', eventId: 'e1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.result, 'duplicate');
});
