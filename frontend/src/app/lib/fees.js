import { formatMoney } from '../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW FEES ARE WORDED, everywhere on the site (owner, 2026-11-24: "connect
 * all fee calculations and create a separate fees file").
 *
 * The amounts are never worked out here — they come from the API, which works
 * them out in one place (backend/utils/fees.js). This file only says them,
 * once, so the organizer's event page, the creation wizard, the admin's fee
 * editor and the buyer's checkout describe a rate in the same words.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const pctText = (pct) => `${Number(Number(pct || 0).toFixed(2))}%`;

/**
 * Eventsli's commission as a rate: "1.5%", or "1.5% + $0.50 per ticket" when
 * there is a fixed part (2026-11-24). `fees` is the API's fee shape
 * ({ commissionPct, commissionFixedCents }).
 */
export function commissionRate(fees, currency) {
  const pct = Number(fees?.commissionPct) || 0;
  const fixed = Number(fees?.commissionFixedCents) || 0;
  if (!fixed) return pctText(pct);
  if (!pct) return `${formatMoney(fixed, currency)} per ticket`;
  return `${pctText(pct)} + ${formatMoney(fixed, currency)} per ticket`;
}

/** The line under the commission: what it is charged on, and who bears it. */
export function commissionNote(fees, currency) {
  const fixed = Number(fees?.commissionFixedCents) || 0;
  return fixed
    ? `Of the ticket price, plus ${formatMoney(fixed, currency)} for each paid ticket. Never on free tickets. Always borne by you.`
    : 'Of the ticket price. Never on free tickets. Always borne by you.';
}

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
  const rate = `${pctText(pct)}${fixed > 0 ? ` + ${formatMoney(fixed, currency)}` : ''}`;
  return basis.mode === 'manual'
    ? `Covers the cost of taking your card payment (${rate} per order).`
    : `Covers the card payment cost charged by Stripe (${rate} per payment).`;
}

/** The payment fee as the organizer reads it on their event. */
export function paymentFeeRate(fees, currency) {
  return fees?.paymentFeeMode === 'auto'
    ? 'Matched to the card cost'
    : `${pctText(fees?.paymentFeePct)} + ${formatMoney(Number(fees?.paymentFeeFixedCents) || 0, currency)}`;
}
