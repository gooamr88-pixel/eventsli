import { formatMoney } from '../utils/money';

/**
 * The note under the buyer's "Card processing fee" line (owner, 2026-11-19).
 *
 * `basis` comes from the quote (backend pricingService): the rate the fee was
 * actually worked out from. Auto mode recovers Stripe's own cost, so the note
 * names Stripe and quotes its rate. Manual mode uses a rate an admin set, so
 * it quotes that rate and does not claim it is Stripe's.
 *
 * The rate is a description, not the arithmetic of the amount. Stripe takes
 * its percentage of the whole payment, fee included, so the fee is a little
 * more than that percentage of the tickets alone.
 */
export function cardFeeNote(basis, currency) {
  if (!basis || !Number.isFinite(Number(basis.pct))) return null;
  const pct = Number(basis.pct);
  const fixed = Number(basis.fixedCents) || 0;
  const rate = `${Number(pct.toFixed(2))}%${fixed > 0 ? ` + ${formatMoney(fixed, currency)}` : ''}`;
  return basis.mode === 'manual'
    ? `Covers the cost of taking your card payment (${rate} per order).`
    : `Covers the card payment cost charged by Stripe (${rate} per payment).`;
}
