const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  openCountries, cardCountries, cardEnabledFor, minorUnits, marketFor,
  SUPPORTED_COUNTRIES, SUPPORTED_MARKETS, CARD_CAPABLE, MARKET_LIST,
} = require('../utils/markets');

/** What every country picker offers: only the countries an admin has open. */

test('a setting never saved opens every supported country', () => {
  assert.deepEqual(openCountries(undefined), [...SUPPORTED_COUNTRIES]);
  assert.deepEqual(openCountries(null), [...SUPPORTED_COUNTRIES]);
});

test('a closed country is not offered', () => {
  assert.deepEqual(openCountries({ CA: 'CAD' }), ['CA']);
  assert.deepEqual(openCountries({ EG: 'EGP' }), ['EG']);
});

test('the order is the table order (by name), not the setting order', () => {
  assert.deepEqual(openCountries({ US: 'USD', CA: 'CAD', EG: 'EGP' }), ['CA', 'EG', 'US']);
});

test('an unknown country or the wrong currency is offered to nobody', () => {
  assert.deepEqual(openCountries({ CA: 'USD', XX: 'XXX', EG: 'USD' }), []);
});

test('a saved setting that opens nothing offers nothing', () => {
  assert.deepEqual(openCountries({}), []);
  assert.deepEqual(openCountries('CA'), []);
  assert.deepEqual(openCountries(['CA']), []);
});

test('every inhabited country is here except those under comprehensive sanctions', () => {
  assert.ok(SUPPORTED_COUNTRIES.length > 230, `only ${SUPPORTED_COUNTRIES.length} countries`);
  for (const c of ['CA', 'US', 'EG', 'SA', 'AE', 'NG', 'KE', 'IN', 'BR', 'JP', 'DE', 'GB', 'AU']) {
    assert.ok(SUPPORTED_MARKETS[c], `${c} missing`);
  }
  for (const c of ['BY', 'CU', 'IR', 'KP', 'RU', 'SY']) assert.equal(SUPPORTED_MARKETS[c], undefined, `${c} present`);
});

test('the currency follows the country', () => {
  assert.equal(SUPPORTED_MARKETS.CA, 'CAD');
  assert.equal(SUPPORTED_MARKETS.EG, 'EGP');
  assert.equal(SUPPORTED_MARKETS.DE, 'EUR');
  assert.equal(SUPPORTED_MARKETS.BG, 'EUR');   // in the euro since 2026-01-01
  assert.equal(marketFor('jp').currency, 'JPY');
});

test('card is possible only where Stripe offers accounts', () => {
  assert.ok(CARD_CAPABLE.includes('CA') && CARD_CAPABLE.includes('US') && CARD_CAPABLE.includes('GB'));
  for (const c of ['EG', 'SA', 'NG', 'KE', 'IN', 'ID']) assert.ok(!CARD_CAPABLE.includes(c), `${c} card-capable`);
});

test('card checkout defaults to the verified countries and is kept to card-capable ones', () => {
  assert.deepEqual(cardCountries(undefined), ['CA', 'US']);
  assert.deepEqual(cardCountries(['us', 'EG', 'GB']), ['GB', 'US']);   // table order, EG dropped
  assert.deepEqual(cardCountries('CA'), []);
  assert.equal(cardEnabledFor('CA', undefined), true);
  assert.equal(cardEnabledFor('EG', { card: ['EG'] }), false);
  assert.equal(cardEnabledFor('GB', { card: ['CA'] }), false);
  assert.equal(cardEnabledFor('gb', { card: ['GB'] }), true);
});

test('minor units follow ISO 4217, not Intl display defaults', () => {
  assert.equal(minorUnits('CAD'), 2);
  assert.equal(minorUnits('JPY'), 0);
  assert.equal(minorUnits('XOF'), 0);
  assert.equal(minorUnits('KWD'), 3);
  assert.equal(minorUnits('HUF'), 2);   // Intl shows none; Stripe charges two
  assert.equal(minorUnits('IDR'), 2);
});

test('every row is well formed', () => {
  for (const m of MARKET_LIST) {
    assert.match(m.country, /^[A-Z]{2}$/);
    assert.match(m.currency, /^[A-Z]{3}$/);
    assert.ok(m.name && m.name !== m.country, m.country);
    assert.ok(m.region, m.country);
    assert.equal(typeof m.card, 'boolean');
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: m.zone }), m.zone);
  }
});

test('the frontend holds the same table, byte for byte', () => {
  const ours = fs.readFileSync(path.join(__dirname, '..', 'utils', 'markets.json'), 'utf8');
  const theirs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'lib', 'markets.json'), 'utf8');
  assert.equal(theirs, ours);
});

test('the migration seeds every row of the table', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261121090000_global_markets.sql'), 'utf8');
  for (const m of MARKET_LIST) {
    const row = `('${m.country}', '${m.name.replace(/'/g, "''")}', '${m.currency}', ${minorUnits(m.currency)}, '${m.region}', ${m.card})`;
    assert.ok(sql.includes(row), `migration lacks ${row}`);
  }
});
