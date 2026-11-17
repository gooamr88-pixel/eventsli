import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MARKETS, COUNTRIES, CURRENCIES, COUNTRY_OPTIONS, MARKET_ROWS, DEFAULT_COUNTRY, CARD_CAPABLE, REGIONS,
  currencyFor, minorUnits, zoneFor,
  currencyOf, currencySymbol, currencyName, currencyTag, withCurrency, currencyHint,
} from '../src/app/lib/markets';
import { formatMoney, formatMoneyCompact, formatPrice } from '../src/app/utils/money';
import { parseMoneyToCents, centsToInput, moneyPlaceholder } from '../src/app/lib/moneyInput';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MARKET LIST HAS TO AGREE WITH THE API'S (BRD §07).
 *
 * Both sides read a `markets.json`, and they must be the same file: a country
 * the API opens but no form offers fails silently in the worst direction —
 * the backend accepts it, the database allows it, and nobody can select it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const BACKEND = path.join(process.cwd(), '..', 'backend', 'utils', 'markets.json');
const FRONTEND = path.join(process.cwd(), 'src', 'app', 'lib', 'markets.json');

describe('the market table matches the API', () => {
  test('the two markets.json files are byte-identical', () => {
    expect(fs.readFileSync(FRONTEND, 'utf8')).toBe(fs.readFileSync(BACKEND, 'utf8'));
  });

  test('the derived lists follow the table rather than being written out', () => {
    expect(COUNTRIES).toEqual(Object.keys(MARKETS));
    expect(CURRENCIES).toEqual([...new Set(Object.values(MARKETS))].sort());
    expect(COUNTRY_OPTIONS.map(([code]) => code)).toEqual(COUNTRIES);
    expect(MARKET_ROWS.map((m) => m.country)).toEqual(COUNTRIES);
  });

  test('every market row carries the currency its country is priced in', () => {
    for (const row of MARKET_ROWS) expect(row.currency, row.country).toBe(MARKETS[row.country]);
  });

  test('every country has a name to show, and none is a bare code', () => {
    for (const [code, name] of COUNTRY_OPTIONS) {
      expect(name, code).toBeTruthy();
      expect(name, code).not.toBe(code);
    }
  });

  test('the whole world is here, card only where Stripe operates', () => {
    expect(COUNTRIES.length).toBeGreaterThan(230);
    expect(COUNTRIES).toContain('EG');
    expect(CARD_CAPABLE).toContain('GB');
    expect(CARD_CAPABLE).not.toContain('EG');
    expect(REGIONS.length).toBeGreaterThan(3);
  });

  test('the default country is a real market', () => {
    expect(COUNTRIES).toContain(DEFAULT_COUNTRY);
  });

  test('a country names its main time zone', () => {
    expect(zoneFor('EG')).toBe('Africa/Cairo');
    expect(zoneFor('zz')).toBeNull();
  });
});

describe('currencyFor', () => {
  test('maps each market', () => {
    expect(currencyFor('CA')).toBe('CAD');
    expect(currencyFor('US')).toBe('USD');
    expect(currencyFor('EG')).toBe('EGP');
    expect(currencyFor('FR')).toBe('EUR');
  });

  test('is case insensitive, because a country code arrives from several places', () => {
    expect(currencyFor('ca')).toBe('CAD');
  });

  /**
   * It labels money that already exists. A dashboard that throws on an
   * unexpected code is worse than one that names the wrong currency for a
   * moment — and the API is what actually prices anything.
   */
  test('an unknown country falls back rather than throwing', () => {
    for (const odd of ['ZZ', '', null, undefined, 42]) {
      expect(currencyFor(odd), String(odd)).toBe(MARKETS[DEFAULT_COUNTRY]);
    }
  });
});

describe('money follows each currency’s decimals', () => {
  test('minor units are ISO 4217', () => {
    expect(minorUnits('USD')).toBe(2);
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KWD')).toBe(3);
    expect(minorUnits('HUF')).toBe(2);
  });

  test('formatting divides by the right scale', () => {
    const plain = (s) => s.replace(/\s/g, ' ');
    expect(formatMoney(1999, 'USD')).toBe('$19.99');
    expect(formatMoney(3000, 'JPY')).toBe('¥3,000');
    expect(plain(formatMoney(12500, 'KWD'))).toBe('KWD 12.500');
    expect(formatMoneyCompact(3000, 'JPY')).toBe('¥3,000');
    expect(formatMoneyCompact(1250, 'EUR')).toBe('€12.50');
    expect(formatMoneyCompact(1200, 'EUR')).toBe('€12');
    expect(formatPrice(0, 'EGP')).toBe('Free');
  });

  test('a typed price is read in the currency’s own unit', () => {
    expect(parseMoneyToCents('25.50', 'USD')).toBe(2550);
    expect(parseMoneyToCents('3000', 'JPY')).toBe(3000);
    expect(parseMoneyToCents('30.5', 'JPY')).toBeNull();
    expect(parseMoneyToCents('12.5', 'KWD')).toBe(12500);
    expect(parseMoneyToCents('19.999', 'USD')).toBeNull();
    expect(centsToInput(2550, 'USD')).toBe('25.5');
    expect(centsToInput(3000, 'JPY')).toBe('3000');
    expect(centsToInput(12500, 'KWD')).toBe('12.5');
    expect(centsToInput(null, 'USD')).toBe('');
    expect(moneyPlaceholder('JPY')).toBe('0');
    expect(moneyPlaceholder('KWD')).toBe('0.000');
  });
});

describe('each country says its currency (2026-11-17)', () => {
  test('every country has its own currency, with no CAD fallback for an unknown one', () => {
    expect(currencyOf('EG')).toBe('EGP');
    expect(currencyOf('gb')).toBe('GBP');
    expect(currencyOf('FR')).toBe('EUR');
    expect(currencyOf('ZZ')).toBeNull();
  });

  test('symbols are distinctive: no bare "$" standing in for CAD', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('CAD')).toBe('CA$');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('EGP')).toBe('E£');
    expect(currencySymbol('AED')).toBeNull();
    expect(currencyTag('AED')).toBe('AED');
    expect(currencyTag('EGP')).toBe('EGP (E£)');
  });

  test('a country list names each currency', () => {
    expect(withCurrency([['EG', 'Egypt'], ['CA', 'Canada']])).toEqual([
      ['EG', 'Egypt — EGP (E£)'], ['CA', 'Canada — CAD (CA$)'],
    ]);
    expect(withCurrency(COUNTRY_OPTIONS).every(([, label]) => / — [A-Z]{3}/.test(label))).toBe(true);
  });

  test('the hint says the currency, and never "CAD or USD"', () => {
    expect(currencyName('EGP')).toMatch(/Egyptian Pound/i);
    const hint = currencyHint('EG');
    expect(hint).toMatch(/EGP \(E£\)/);
    expect(hint).not.toMatch(/CAD or USD/);
    expect(currencyHint('ZZ')).toBeNull();
  });
});
