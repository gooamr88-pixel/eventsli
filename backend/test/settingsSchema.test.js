const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSetting, SETTING_DEFAULTS, EDITABLE_SETTINGS } = require('../utils/settingsSchema');

/**
 * Each of these used to be one save away from production: the API checked only
 * that a value existed.
 */

test('every default passes its own schema', () => {
  for (const key of EDITABLE_SETTINGS) {
    const result = validateSetting(key, SETTING_DEFAULTS[key]);
    assert.equal(result.ok, true, `${key}: ${result.errors?.join(' ')}`);
  }
});

test('a commission over 100% is refused', () => {
  const result = validateSetting('commission', { default_pct: 150, default_tax_pct: 0 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /between 0 and 100/);
});

test('null, strings and missing fields are refused rather than stored', () => {
  assert.equal(validateSetting('commission', null).ok, false);
  assert.equal(validateSetting('commission', { default_pct: '1.5', default_tax_pct: 0 }).ok, false);
  assert.match(validateSetting('stripe_cost', { pct: 2.9 }).errors.join(' '), /required/);
});

test('unknown fields and unknown keys are refused', () => {
  assert.match(validateSetting('commission', { default_pct: 1, default_tax_pct: 0, extra: 1 }).errors.join(' '), /extra/);
  assert.equal(validateSetting('anything_else', {}).ok, false);
});

test('fixed amounts are whole cents and percentages have at most two decimals', () => {
  assert.equal(validateSetting('payment_fee', { default_pct: 2.9, default_fixed_cents: 30.5 }).ok, false);
  assert.equal(validateSetting('payment_fee', { default_pct: 2.905, default_fixed_cents: 30 }).ok, false);
  assert.equal(validateSetting('payment_fee', { default_pct: 2.95, default_fixed_cents: 30, default_mode: 'manual' }).ok, true);
});

test('closing every market is refused — no event could be created anywhere', () => {
  assert.match(validateSetting('currencies', {}).errors.join(' '), /at least one market/);
  assert.equal(validateSetting('currencies', { by_country: {} }).ok, false);
});

test('the currency follows the country, and allowed is derived rather than trusted', () => {
  assert.match(validateSetting('currencies', { by_country: { CA: 'USD' } }).errors.join(' '), /CA sells in CAD/);
  assert.match(validateSetting('currencies', { by_country: { EG: 'EGP' } }).errors.join(' '), /not a market/);

  const result = validateSetting('currencies', { allowed: ['USD', 'EUR'], by_country: { CA: 'CAD' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { allowed: ['CAD'], by_country: { CA: 'CAD' } });
});
