import { test, expect } from 'vitest';
import { gridCta, gridPlace, gridWhen } from '../src/app/events/EventGridCard';

/**
 * The /events card (owner's reference, 2026-11-19): "Tickets From CA$120",
 * "Nov 6, 2026 · 8:30 pm" and the street address.
 */
test('an on-sale event reads "Tickets From" its lowest price, with the currency', () => {
  expect(gridCta({ fromPriceCents: 12000, currency: 'CAD' })).toBe('Tickets From CA$120');
});

test('a free event says Free Tickets, a sold-out one Sold out', () => {
  expect(gridCta({ fromPriceCents: 0, currency: 'CAD' })).toBe('Free Tickets');
  expect(gridCta({ fromPriceCents: 2500, currency: 'CAD', availability: { soldOut: true } })).toBe('Sold out');
});

test('nothing buyable never promises tickets', () => {
  expect(gridCta({ fromPriceCents: null })).toBe('View event');
  expect(gridCta({ comingSoon: true })).toBe('Notify me');
  expect(gridCta({ displayOnly: true })).toBe('Details');
});

test('the date is in the event zone, with the year and the time', () => {
  // 01:30 UTC on Nov 7 is 8:30 pm on Nov 6 in Toronto.
  expect(gridWhen({ startsAt: '2026-11-07T01:30:00Z', timezone: 'America/Toronto' })).toBe('Nov 6, 2026 · 8:30 pm');
  expect(gridWhen({ startsAt: '2026-11-07T01:30:00Z', comingSoon: true })).toBeNull();
});

test('the street address wins; otherwise venue and city', () => {
  expect(gridPlace({ venueAddress: '11 Polson St, Toronto', venue: 'Rebel', city: 'Toronto' })).toBe('11 Polson St, Toronto');
  expect(gridPlace({ venue: 'Rebel', city: 'Toronto' })).toBe('Rebel, Toronto');
});
