import { describe, test, expect } from 'vitest';
import { parseSearch, withoutPhrase, safeTimeZone } from '../src/app/lib/smartSearch';

/**
 * Smart search: what people type into an event search, read into filters.
 * Deterministic, so every case is exact.
 */

// Tuesday 3 November 2026, 10:00 in Toronto.
const NOW = new Date('2026-11-03T15:00:00Z');
const CTX = {
  now: NOW,
  timeZone: 'America/Toronto',
  cities: ['Toronto', 'New York', 'York', 'Montréal', 'Ottawa'],
  categories: [
    { slug: 'music', label: 'Music' }, { slug: 'comedy', label: 'Comedy' },
    { slug: 'food_drink', label: 'Food & drink' }, { slug: 'gala', label: 'Galas & banquets' },
  ],
};
const parse = (q, ctx = CTX) => parseSearch(q, ctx);

describe('the example everyone types', () => {
  const r = parse('jazz this weekend in Toronto under $40');

  test('becomes a genre, a weekend, a city and a price', () => {
    expect(r).toMatchObject({ category: 'music', city: 'Toronto', maxPriceCents: 4000, keywords: 'jazz' });
    // Friday 6 Nov 00:00 → Monday 9 Nov 00:00, Toronto time (EST, UTC−5).
    expect(r.from).toBe('2026-11-06T05:00:00.000Z');
    expect(r.to).toBe('2026-11-09T05:00:00.000Z');
  });

  test('says what it understood, so it can be shown and undone', () => {
    expect(r.understood.map((u) => u.label)).toEqual(['Under $40', 'This weekend', 'In Toronto', 'Music']);
    expect(withoutPhrase('jazz this weekend in Toronto under $40', 'this weekend')).toBe('jazz in Toronto under $40');
  });
});

describe('dates', () => {
  test('today, tonight and tomorrow are the reader’s days', () => {
    expect(parse('comedy tomorrow')).toMatchObject({ from: '2026-11-04T05:00:00.000Z', to: '2026-11-05T05:00:00.000Z', category: 'comedy', keywords: '' });
    expect(parse('tonight').from).toBe(NOW.toISOString());
  });

  test('a weekday is its next occurrence, today included', () => {
    expect(parse('on friday').from).toBe('2026-11-06T05:00:00.000Z');
    expect(parse('tuesday night').from).toBe('2026-11-03T05:00:00.000Z');
  });

  test('a month, and a day in a month, roll into next year once past', () => {
    expect(parse('december').from).toBe('2026-12-01T05:00:00.000Z');
    expect(parse('in november').from).toBe('2026-11-03T05:00:00.000Z');
    expect(parse('jan 12')).toMatchObject({ from: '2027-01-12T05:00:00.000Z', to: '2027-01-13T05:00:00.000Z' });
    expect(parse('nov 1').from).toBe('2027-11-01T04:00:00.000Z');
  });

  test('"may" the verb and "march" the verb are not months', () => {
    expect(parse('things you may like').from).toBeNull();
    expect(parse('may 2').from).toBe('2027-05-02T04:00:00.000Z');
  });

  test('on a Saturday, "this weekend" is the weekend in progress', () => {
    const sat = parse('this weekend', { ...CTX, now: new Date('2026-11-07T15:00:00Z') });
    expect(sat.from).toBe('2026-11-06T05:00:00.000Z');
  });
});

describe('places and kinds', () => {
  test('only a city with events counts — half-typed is not a city', () => {
    expect(parse('gala in Tor')).toMatchObject({ city: null, category: 'gala', keywords: 'tor' });
    expect(parse('comedy new york').city).toBe('New York', 'longest name first');
  });

  test('a category’s own name is a filter; a genre stays in the text too', () => {
    expect(parse('comedy in ottawa')).toMatchObject({ category: 'comedy', keywords: '', city: 'Ottawa' });
    expect(parse('wine tasting')).toMatchObject({ category: 'food_drink', keywords: 'wine tasting' });
  });

  test('a category that is not live is never applied', () => {
    expect(parse('yoga morning').category).toBeNull();
  });

  test('free is a price of zero', () => {
    expect(parse('free concerts')).toMatchObject({ maxPriceCents: 0, category: 'music', keywords: '' });
  });

  test('plain text stays exactly as typed, small words included', () => {
    expect(parse('Neon Nights')).toMatchObject({ keywords: 'Neon Nights', city: null, category: null, from: null, maxPriceCents: null, understood: [] });
    expect(parse('An Evening of Elegance').keywords).toBe('An Evening of Elegance');
  });

  test('around a recognised phrase, inner words are kept and only edge filler goes', () => {
    expect(parse('evening of elegance in Ottawa')).toMatchObject({ city: 'Ottawa', keywords: 'evening of elegance' });
    expect(parse('things to do this weekend')).toMatchObject({ keywords: '', from: '2026-11-06T05:00:00.000Z' });
  });
});

test('a time zone from a URL is checked before it is used', () => {
  expect(safeTimeZone('America/Vancouver')).toBe('America/Vancouver');
  expect(safeTimeZone('Mars/Olympus')).toBe('America/Toronto');
  expect(safeTimeZone(undefined)).toBe('America/Toronto');
});
