const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openCountries, SUPPORTED_COUNTRIES } = require('../utils/markets');

/** What every country picker offers: only the markets an admin has open. */

test('a setting never saved opens every supported market', () => {
  assert.deepEqual(openCountries(undefined), [...SUPPORTED_COUNTRIES]);
  assert.deepEqual(openCountries(null), [...SUPPORTED_COUNTRIES]);
});

test('a closed market is not offered', () => {
  assert.deepEqual(openCountries({ CA: 'CAD' }), ['CA']);
  assert.deepEqual(openCountries({ US: 'USD' }), ['US']);
});

test('the order is the table order, not the setting order', () => {
  assert.deepEqual(openCountries({ US: 'USD', CA: 'CAD' }), ['CA', 'US']);
});

test('an unknown country or the wrong currency is offered to nobody', () => {
  assert.deepEqual(openCountries({ CA: 'USD', MX: 'MXN' }), []);
});

test('a saved setting that opens nothing offers nothing', () => {
  assert.deepEqual(openCountries({}), []);
  assert.deepEqual(openCountries('CA'), []);
  assert.deepEqual(openCountries(['CA']), []);
});
