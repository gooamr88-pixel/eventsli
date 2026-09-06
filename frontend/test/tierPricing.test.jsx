import { describe, test, expect } from 'vitest';
import { toCents } from '../src/app/organizer/events/[id]/tiers/Tiers';

/**
 * Dollars typed by a person → integer cents.
 *
 * The one place the frontend converts money rather than formatting it, and the
 * one place a float can get in. Everything downstream — the quote, the ledger,
 * what Stripe charges — is integer cents, so a mistake here is a mistake in the
 * price of every ticket sold under that tier.
 */
describe('toCents', () => {
  test('whole dollars', () => {
    expect(toCents('25')).toBe(2500);
    expect(toCents('0')).toBe(0);
    expect(toCents('1000')).toBe(100000);
  });

  test('the classic float bug does not happen', () => {
    // `19.99 * 100` is 1998.9999999999998. Truncating gives 1998 — a cent short
    // on every single ticket, which is a real number by settlement.
    expect(toCents('19.99')).toBe(1999);
    expect(19.99 * 100).not.toBe(1999);

    // A spread of values that all misbehave under naive multiplication.
    expect(toCents('4.35')).toBe(435);
    expect(toCents('8.87')).toBe(887);
    expect(toCents('129.29')).toBe(12929);
  });

  test('one decimal place is fine', () => {
    expect(toCents('25.5')).toBe(2550);
  });

  test('anything that is not money is refused, not coerced', () => {
    // The string is parsed rather than trusted, so junk cannot become a price.
    // `Number('')` is 0 and `Number(' 25 ')` is 25 — both would sail through a
    // Number()-first implementation.
    for (const bad of ['', 'abc', '25.999', '-5', '1e3', '$25', '25,50', null, undefined, {}]) {
      expect(toCents(bad), String(bad)).toBeNull();
    }
  });

  test('surrounding whitespace is tolerated', () => {
    // People paste prices.
    expect(toCents('  25.50  ')).toBe(2550);
  });

  test('free is zero, and zero is a real price', () => {
    // Not null, and not "unset". A free tier is a thing organizers create.
    expect(toCents('0')).toBe(0);
    expect(toCents('0.00')).toBe(0);
  });
});
