import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MARKETS, COUNTRIES, CURRENCIES, COUNTRY_OPTIONS, MARKET_ROWS, DEFAULT_COUNTRY, currencyFor,
} from '../src/app/lib/markets';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MARKET LIST HAS TO AGREE WITH THE API'S (BRD §07).
 *
 * `backend/utils/markets.js` says the table is read "in three known places" —
 * the organizer sign-up route, the settings schema, and the database's CHECK
 * constraints. There were four more it did not count, all in the frontend, and
 * they are the ones that decide whether a market can be SELECTED at all:
 *
 *     admin/settings/Settings.jsx        the switches that open a market
 *     organizer/CreateProfile.jsx        the organization's country
 *     organizer/events/new/NewEventForm  the event's country
 *     organizer/dashboard/Dashboard.jsx  country → currency, as a ternary
 *
 * Opening a third market with those out of step fails silently in the worst
 * direction: the API accepts it, the database allows it, and no form offers it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const BACKEND = path.join(process.cwd(), '..', 'backend', 'utils', 'markets.js');

describe('the market table matches the API', () => {
  test('country → currency is identical', () => {
    const src = fs.readFileSync(BACKEND, 'utf8');
    const body = src.match(/SUPPORTED_MARKETS = Object\.freeze\(\{([^}]*)\}\)/)?.[1];
    expect(body, 'could not find SUPPORTED_MARKETS in the API').toBeTruthy();

    const theirs = Object.fromEntries(
      body.split(',').map((p) => p.split(':').map((s) => s.trim().replace(/['"]/g, '')))
        .filter((p) => p[0]),
    );
    expect(theirs).toEqual({ ...MARKETS });
  });

  test('the derived lists follow the table rather than being written out', () => {
    expect(COUNTRIES).toEqual(Object.keys(MARKETS));
    expect(CURRENCIES).toEqual([...new Set(Object.values(MARKETS))]);
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

  test('the default country is a real market', () => {
    expect(COUNTRIES).toContain(DEFAULT_COUNTRY);
  });
});

describe('currencyFor', () => {
  test('maps each market', () => {
    expect(currencyFor('CA')).toBe('CAD');
    expect(currencyFor('US')).toBe('USD');
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
