import { test, expect } from 'vitest';
import { saleTag } from '../src/app/components/EventCard';

/**
 * The sale tag on an event card (EventCard saleTag, 2026-11-15). "Tickets on
 * sale" is a promise: it must only appear when something can be bought here.
 */
test('a display-only listing is "Info only", whatever else it carries', () => {
  expect(saleTag({ displayOnly: true, fromPriceCents: 2500 })).toMatchObject({ kind: 'info' });
});

test('a sold-out event says so', () => {
  expect(saleTag({ availability: { soldOut: true }, fromPriceCents: 2500 })).toMatchObject({ kind: 'sold-out' });
});

test('a ticketed event with a buyable price is on sale — free counts', () => {
  expect(saleTag({ fromPriceCents: 2500 })).toMatchObject({ kind: 'on-sale', label: 'Tickets on sale' });
  expect(saleTag({ fromPriceCents: 0 })).toMatchObject({ kind: 'on-sale' });
});

test('no buyable price yet (sales not open) → no tag, rather than a false claim', () => {
  expect(saleTag({ fromPriceCents: null })).toBeNull();
});

test('the single-event payload (tiers, no fromPriceCents) is read too', () => {
  expect(saleTag({ tiers: [{ id: 'a' }] })).toMatchObject({ kind: 'on-sale' });
  expect(saleTag({ tiers: [] })).toBeNull();
});

// 2026-11-18 (owner): past events, sold out, selling fast.
test('a past event says "Past event", ahead of every other state', () => {
  expect(saleTag({ isPast: true, fromPriceCents: 2500 })).toMatchObject({ kind: 'past', label: 'Past event' });
  expect(saleTag({ isPast: true, availability: { soldOut: true } })).toMatchObject({ kind: 'past' });
  expect(saleTag({ isPast: true, comingSoon: true })).toMatchObject({ kind: 'past' });
});

test('nearly gone is "Selling fast" — but only when something can be bought', () => {
  expect(saleTag({ fromPriceCents: 2500, availability: { sellingFast: true } })).toMatchObject({ kind: 'fast', label: 'Selling fast' });
  expect(saleTag({ fromPriceCents: null, availability: { sellingFast: true } })).toBeNull();
  expect(saleTag({ availability: { soldOut: true, sellingFast: false }, fromPriceCents: 2500 })).toMatchObject({ kind: 'sold-out', label: 'Sold out' });
});
