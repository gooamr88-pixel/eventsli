const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// No database: `policy` is a pure function. The Supabase client is replaced
// before the service loads. This used to load helpers/testEnv — the
// INTEGRATION helper, which refuses to start without a local SUPABASE_URL —
// so CI's unit-test job (no database, no .env) failed on this file alone.
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase: {} } };
const { policy } = require('../services/scanRetention');

// services/scanRetention.js — what SCAN_RETENTION_* in .env turns into.

test('off by default, 90 days', () => {
  assert.deepEqual(policy({}), { mode: 'off', days: 90, error: null });
});

test('report and delete are the only other modes; anything else is off', () => {
  assert.equal(policy({ SCAN_RETENTION_MODE: 'report' }).mode, 'report');
  assert.equal(policy({ SCAN_RETENTION_MODE: ' DELETE ' }).mode, 'delete');
  assert.equal(policy({ SCAN_RETENTION_MODE: 'yes' }).mode, 'off');
  assert.equal(policy({ SCAN_RETENTION_MODE: 'true' }).mode, 'off');
});

test('a window under 30 days switches it off with an error, never clamps', () => {
  const p = policy({ SCAN_RETENTION_MODE: 'delete', SCAN_RETENTION_DAYS: '7' });
  assert.equal(p.mode, 'off');
  assert.match(p.error, /at least 30/);
});

test('an unreadable number falls back to 90', () => {
  assert.equal(policy({ SCAN_RETENTION_DAYS: 'ninety' }).days, 90);
  assert.equal(policy({ SCAN_RETENTION_DAYS: '180' }).days, 180);
});
