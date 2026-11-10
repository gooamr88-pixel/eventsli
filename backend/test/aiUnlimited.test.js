const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configFor, isUnlimited, UNLIMITED } = require('../services/ai/config');

// The assistant controller builds a Supabase client on load; nothing here
// reaches the database, so placeholders are enough.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';
const { aiAvailable, _usage: usage } = require('../controllers/assistantController');

/** Super admin accounts have no limits on any AI feature (owner, 2026-11-10). */

const base = Object.freeze({ enabled: true, limit: 2, globalCap: 500, window: '24 hours', assistant: { enabled: true, cap: 0 } });

test('only a super admin is unlimited: not an admin, an organizer or a visitor', () => {
  assert.equal(isUnlimited({ isAdmin: true, isSuperAdmin: true }), true);
  assert.equal(isUnlimited({ isAdmin: true, isSuperAdmin: false }), false);
  assert.equal(isUnlimited({ isAdmin: false, isSuperAdmin: false }), false);
  assert.equal(isUnlimited(undefined), false);
});

test('a super admin has no daily allowance and no platform cap', () => {
  const cfg = configFor(base, { isSuperAdmin: true });
  assert.equal(cfg.unlimited, true);
  assert.equal(cfg.limit, UNLIMITED);
  assert.equal(cfg.globalCap, null, 'NULL is "no platform ceiling" to ai_reserve_generation');
  assert.equal(cfg.window, base.window, 'the correctness rules are untouched');
});

test('everyone else keeps the configured limits', () => {
  const cfg = configFor(base, { isAdmin: true, isSuperAdmin: false });
  assert.equal(cfg.unlimited, false);
  assert.equal(cfg.limit, 2);
  assert.equal(cfg.globalCap, 500);
});

test('UNLIMITED fits the database function’s INT parameter', () => {
  assert.equal(UNLIMITED, 2 ** 31 - 1);
});

test('the homepage assistant’s daily cap does not stop a super admin', () => {
  Object.assign(usage, { day: new Date().toISOString().slice(0, 10), count: 0 });
  assert.equal(aiAvailable(base), false, 'a cap of 0 stops a visitor');
  assert.equal(aiAvailable(base, { unlimited: true }), true);
  assert.equal(aiAvailable({ ...base, enabled: false }, { unlimited: true }), false, 'AI switched off is still off');
});
