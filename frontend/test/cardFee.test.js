import { describe, test, expect } from 'vitest';
import { cardFeeNote } from '../src/app/lib/cardFee';

/**
 * The note under the buyer's "Card processing fee" (2026-11-19). It must
 * quote the rate the fee was actually worked out from: Stripe's in auto
 * mode, the admin's own in manual mode, and never name Stripe for the latter.
 */
describe('cardFeeNote', () => {
  test('auto mode names Stripe and its rate', () => {
    const note = cardFeeNote({ mode: 'auto', pct: 2.9, fixedCents: 30 }, 'CAD');
    expect(note).toMatch(/Stripe/);
    expect(note).toMatch(/2\.9% \+ CA\$0\.30 per payment/);
  });

  test('manual mode quotes the set rate and does not claim it is Stripe\'s', () => {
    const note = cardFeeNote({ mode: 'manual', pct: 3.5, fixedCents: 50 }, 'CAD');
    expect(note).not.toMatch(/Stripe/);
    expect(note).toMatch(/3\.5% \+ CA\$0\.50 per order/);
  });

  test('no fixed part, no "+ $0.00"', () => {
    expect(cardFeeNote({ mode: 'manual', pct: 4, fixedCents: 0 }, 'CAD')).toMatch(/\(4% per order\)/);
  });

  test('no basis, no note', () => {
    expect(cardFeeNote(null, 'CAD')).toBeNull();
    expect(cardFeeNote({ mode: 'auto', pct: 'x' }, 'CAD')).toBeNull();
  });
});
