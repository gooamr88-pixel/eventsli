import { describe, test, expect } from 'vitest';
import { ctaFor } from '../src/app/e/[slug]/EventPurchasePanel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAY INTO AN EVENT, per event type.
 *
 * `ctaFor` is read twice — by the sticky purchase panel on a laptop and by the
 * phone's fixed buy bar — and the two must always agree. They agreed by
 * accident before, because there was only one of them; now that there are two
 * call sites this is what stops them drifting.
 *
 * The cases below are the event types the product actually sells, and each one
 * changes where the buyer is sent:
 *
 *   reserved seating  → the seat map
 *   general admission → the ticket picker, because there is no map
 *   display only      → nowhere; BRD §12, it is a listing with nothing behind it
 *   sold out          → nowhere
 *   free              → the same place, said without the language of buying
 *
 * A wrong answer here is not cosmetic. Sending a general-admission buyer to
 * `/seats` lands them on a redirect, and sending a reserved buyer to `/tickets`
 * lands them on one going the other way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const base = {
  slug: 'an-evening-on-the-waterfront',
  currency: 'CAD',
  admissionType: 'reserved',
  displayOnly: false,
  tiers: [{ id: 't1', priceCents: 7900 }],
};

describe('ctaFor — where each kind of event sends the buyer', () => {
  test('reserved seating goes to the seat map, and says so', () => {
    const cta = ctaFor(base, false);
    expect(cta.kind).toBe('buy');
    expect(cta.href).toBe('/e/an-evening-on-the-waterfront/seats');
    expect(cta.label).toBe('Choose your seats');
  });

  test('general admission goes to the ticket picker, never the map', () => {
    const cta = ctaFor({ ...base, admissionType: 'general' }, false);
    expect(cta.href).toBe('/e/an-evening-on-the-waterfront/tickets');
    // "Choose your seats" on an event with no seats is a promise the next page
    // cannot keep.
    expect(cta.label).toBe('Get tickets');
  });

  test('a display-only listing offers no way in at all', () => {
    const cta = ctaFor({ ...base, displayOnly: true }, false);
    expect(cta.kind).toBe('listing');
    expect(cta.href).toBeUndefined();
  });

  test('a sold-out event offers no way in either', () => {
    const cta = ctaFor(base, true);
    expect(cta.kind).toBe('soldout');
    expect(cta.href).toBeUndefined();
  });

  test('display-only wins over sold-out — it is the stronger claim', () => {
    expect(ctaFor({ ...base, displayOnly: true }, true).kind).toBe('listing');
  });
});

describe('ctaFor — free events', () => {
  test('every tier at zero drops the language of buying', () => {
    const cta = ctaFor({ ...base, tiers: [{ id: 't1', priceCents: 0 }] }, false);
    expect(cta.free).toBe(true);
    expect(cta.label).toBe('Get tickets');
    // Still the seat map: free and reserved is a real combination, and a free
    // event with a drawn room still needs a seat chosen.
    expect(cta.href).toBe('/e/an-evening-on-the-waterfront/seats');
  });

  test('one paid tier among free ones is not a free event', () => {
    const cta = ctaFor(
      { ...base, tiers: [{ id: 'a', priceCents: 0 }, { id: 'b', priceCents: 5000 }] },
      false,
    );
    expect(cta.free).toBe(false);
    expect(cta.label).toBe('Choose your seats');
  });

  test('an event with no tiers yet is not treated as free', () => {
    // `[].every()` is true, which would have called a tier-less event free and
    // offered "Get tickets" for tickets that do not exist.
    expect(ctaFor({ ...base, tiers: [] }, false).free).toBe(false);
  });
});

describe('ctaFor — the tier travels with the buyer', () => {
  test('a chosen tier is carried into the next page', () => {
    expect(ctaFor(base, false, 't1').href)
      .toBe('/e/an-evening-on-the-waterfront/seats?tier=t1');
  });

  test('no tier means no stray query string', () => {
    expect(ctaFor(base, false, null).href).not.toContain('?');
  });

  test('a tier id is encoded, not concatenated', () => {
    expect(ctaFor(base, false, 'a b&c').href).toContain('tier=a%20b%26c');
  });
});
