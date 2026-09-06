import { describe, test, expect } from 'vitest';
import {
  formatMoney, formatMoneyCompact, formatPriceRange, formatPrice,
} from '../src/app/utils/money';

describe('money', () => {
  test('renders integer cents, never a float', () => {
    expect(formatMoney(1999, 'USD')).toBe('$19.99');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
  });

  test('the currency comes from the event, and CAD is distinguishable', () => {
    // A Canadian buyer being shown "$45" for a CAD price is not a cosmetic
    // problem — it is a different amount of money, and the platform sells into
    // both markets from one storefront.
    expect(formatMoney(4500, 'CAD')).toBe('CA$45.00');
    expect(formatMoney(4500, 'USD')).toBe('$45.00');
  });

  test('a missing amount renders as an em dash, not as zero', () => {
    // A tier with no price is unpriced, which is not the same claim as free.
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'USD')).toBe('—');
    expect(formatMoney(NaN, 'USD')).toBe('—');
  });

  test('compact drops decimals only when there are none to drop', () => {
    expect(formatMoneyCompact(4500, 'USD')).toBe('$45');
    // The trap this guards: rounding for display makes the card say $20 and
    // the checkout say $19.99, and the buyer notices every time.
    expect(formatMoneyCompact(1999, 'USD')).toBe('$19.99');
  });

  test('a price range collapses when every tier costs the same', () => {
    expect(formatPriceRange([2500, 2500], 'USD')).toBe('$25');
    expect(formatPriceRange([2500, 8000], 'USD')).toBe('$25 – $80');
  });

  test('unpriced tiers are dropped from a range, not read as zero', () => {
    // Otherwise one tier still awaiting a price renders the whole event as
    // "From $0", which is a claim the platform cannot honour.
    expect(formatPriceRange([null, 2500, undefined], 'USD')).toBe('$25');
    expect(formatPriceRange([null, null], 'USD')).toBeNull();
    expect(formatPriceRange([], 'USD')).toBeNull();
  });

  test('free is a word, and only where the caller asked for it', () => {
    expect(formatPrice(0, 'USD')).toBe('Free');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  test('this module exposes no arithmetic', async () => {
    // The rule, asserted rather than documented: totals come from
    // GET /public/reservations/:id/quote, computed in the backend where the
    // four fee items are reconciled against what Stripe actually bills. A
    // client that re-derives a total will eventually disagree with the charge,
    // and the version the buyer believes is the one on their screen.
    const mod = await import('../src/app/utils/money');
    const exported = Object.keys(mod).sort();
    expect(exported).toEqual([
      'formatMoney', 'formatMoneyCompact', 'formatPrice', 'formatPriceRange',
    ]);
  });
});
