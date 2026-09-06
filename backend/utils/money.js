/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY PLACE MONEY IS CALCULATED.
 *
 * Every amount in this system is an INTEGER NUMBER OF CENTS. No floats, ever,
 * anywhere — not in the database, not in an API response, not in a local
 * variable. `parseFloat("19.99") * 100` is 1998.9999999999998, and a cent lost
 * per order is a real reconciliation gap by the end of a month.
 *
 * Percentages are the one exception: they arrive as decimals (1.5 means 1.5%)
 * because that is how an admin types them, and they are multiplied out and
 * rounded here, once, at the end.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE FOUR MONEY ITEMS, AND WHY THEY ARE FOUR AND NOT ONE
 *
 *   1. FACE          the ticket price the organizer set.
 *   2. EVENT TAX     % on the face, set by the admin per event/country.
 *                    The ORGANIZER remits this — it passes through us untouched.
 *   3. COMMISSION    Eventsli's cut, % of the face, set by the admin per event.
 *                    Currently 1.5%. Always borne by the ORGANIZER: it is never
 *                    added to the buyer's total in either fee mode.
 *   4. PAYMENT FEE   % + fixed, set by the admin. The ORGANIZER chooses per
 *                    event whether the BUYER or the ORGANIZER bears it.
 *
 * Commission and payment fee are deliberately independent (BRD §04, §05). The
 * commission is margin; the payment fee exists to recover what the card network
 * costs us. Collapsing them into one number is how you end up unable to answer
 * "did that sale actually make money?".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS MODULE EXISTS TO PREVENT
 *
 * We take money with Stripe DESTINATION CHARGES: the charge is created on the
 * platform account, `application_fee_amount` is our slice, and the remainder
 * transfers to the organizer. Stripe's own processing fee is billed to the
 * PLATFORM account — not the organizer's.
 *
 * So Stripe charges its percentage on the FULL buyer total, which includes the
 * event tax AND the payment fee itself. If the payment fee is set to
 * "2.9% + $0.30 of the ticket price" — the intuitive reading — it under-covers
 * on every single order, because Stripe is charging 2.9% of a larger number
 * than the one the fee was computed from.
 *
 *   $100 ticket, 13% tax, payment fee configured as 2.9% + $0.30:
 *     payment fee charged .... $3.20   (2.9% of 100, + 0.30)
 *     buyer total ............ $116.20 (100 + 13 + 3.20)
 *     Stripe actually bills us  $3.67   (2.9% of 116.20, + 0.30)
 *     we collect ............. $4.70   (1.50 commission + 3.20 fee)
 *     we NET ................. $1.03   ← intended $1.50. 31% of margin gone.
 *
 * The tax makes it worse, not better: a higher tax rate means a bigger total
 * for Stripe to take its percentage of, and we never billed for that.
 *
 * `describeOrder` therefore always computes the REAL Stripe cost alongside the
 * configured fee and reports `platformNetCents` and `belowCost`. The admin fee
 * screen paints that red. `solvePaymentFeeCents` gives the fee that would break
 * even exactly, so the number can be set from evidence instead of intuition.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Guard: every amount crossing this module must be a safe integer. */
function assertCents(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} exceeds the safe integer range: ${value}`);
  }
  return value;
}

/**
 * Apply a percentage to a cent amount, rounding half away from zero.
 *
 * Deliberately NOT Math.round: that rounds -0.5 to -0 ("half up" toward
 * positive infinity), so a refund reversal would round differently from the
 * sale it reverses and the pair would not cancel to zero in the ledger.
 */
function pctOf(cents, pct) {
  assertCents(cents, 'base');
  const raw = (cents * Number(pct)) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Money → display string. Presentation only; never feed this back into math. */
function formatCents(cents, currency = 'USD', locale = 'en-CA') {
  assertCents(cents, 'amount');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: String(currency).toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse a human-typed amount ("19.99", "1,299.50") into cents WITHOUT floats.
 *
 * String-split rather than `Math.round(parseFloat(x) * 100)` so the value never
 * passes through a binary float at all. The float route is correct for almost
 * every input, which is exactly what makes the handful it gets wrong so hard to
 * find later.
 */
function parseAmountToCents(input) {
  const s = String(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) {
    throw new TypeError(`Not a valid money amount: "${input}"`);
  }
  const negative = s.startsWith('-');
  const [whole, frac = ''] = (negative ? s.slice(1) : s).split('.');
  const cents = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  return negative ? -cents : cents;
}

/**
 * Stripe's actual cost for a charge of `totalCents`.
 *
 * Rates live in config, not here, because they differ by country and card type
 * and they change. This function only knows the SHAPE of the cost.
 */
function stripeCostCents(totalCents, { pct, fixedCents }) {
  assertCents(totalCents, 'totalCents');
  assertCents(fixedCents, 'stripe.fixedCents');
  if (totalCents <= 0) return 0;
  return pctOf(totalCents, pct) + fixedCents;
}

/**
 * FEE_BEARER — who pays the payment fee. Chosen by the organizer, per event.
 * The commission is NOT affected by this: the organizer bears it either way.
 */
const FEE_BEARER = Object.freeze({ BUYER: 'buyer', ORGANIZER: 'organizer' });

/**
 * PAYMENT_FEE_MODE — how the fee is arrived at. Set by the admin, per event.
 *
 *   AUTO   derive the fee that recovers exactly what Stripe bills for THIS
 *          order. The configured pct/fixed are ignored. Default, because the
 *          correct figure depends on the tax rate and on the fee itself, and is
 *          therefore not a number anyone can set correctly by hand.
 *
 *   MANUAL use the pct/fixed an admin entered. A deliberate choice — a
 *          promotional rate, matching a competitor, or absorbing cost on a
 *          strategic event. Never silently corrected; the shortfall is reported
 *          instead, so the decision stays the admin's and stays visible.
 */
const PAYMENT_FEE_MODE = Object.freeze({ AUTO: 'auto', MANUAL: 'manual' });

/**
 * The fee that recovers Stripe's cost exactly, for a given bearer.
 *
 * The two modes are genuinely different problems, not one with a flag:
 *
 *   organizer-pays — the fee is NOT part of what the buyer is charged, so
 *                    Stripe's cost is a plain function of subtotal + tax.
 *   buyer-pays     — the fee IS part of the total Stripe takes its cut of, so
 *                    it appears on both sides and has to be solved for.
 */
function autoPaymentFeeCents({ subtotalCents, eventTaxCents, feeBearer, stripe }) {
  if (subtotalCents <= 0) return 0;
  return feeBearer === FEE_BEARER.BUYER
    ? solvePaymentFeeCents({ subtotalCents, eventTaxCents, stripe })
    : stripeCostCents(subtotalCents + eventTaxCents, stripe);
}

/**
 * The single authoritative breakdown for an order.
 *
 * @param {object}  o
 * @param {number}  o.faceCents          unit ticket price, in cents
 * @param {number}  o.quantity           number of tickets (>= 1)
 * @param {number}  o.eventTaxPct        tax on the ticket; organizer remits
 * @param {number}  o.commissionPct      Eventsli's cut of the face
 * @param {number}  o.commissionTaxPct   GST/HST on OUR commission; we remit
 * @param {number}  o.paymentFeePct      admin-set, applied to the subtotal
 * @param {number}  o.paymentFeeFixedCents  admin-set, per ORDER (see note)
 * @param {string}  o.feeBearer          FEE_BEARER.BUYER | FEE_BEARER.ORGANIZER
 * @param {object}  o.stripe             { pct, fixedCents } — real cost model
 * @param {number} [o.discountCents=0]   promo discount, applied to the subtotal
 *
 * NOTE ON THE FIXED FEE: it is per ORDER, not per ticket, because it mirrors
 * Stripe's own fixed cost — which is charged once per CHARGE, and an order is
 * one charge no matter how many seats it holds. Making it per-ticket would
 * over-bill a 10-seat order by 9x the fixed component.
 */
function describeOrder({
  faceCents,
  quantity = 1,
  eventTaxPct = 0,
  commissionPct = 0,
  commissionTaxPct = 0,
  paymentFeeMode = PAYMENT_FEE_MODE.AUTO,
  paymentFeePct = 0,
  paymentFeeFixedCents = 0,
  feeBearer = FEE_BEARER.BUYER,
  stripe = { pct: 0, fixedCents: 0 },
  discountCents = 0,
}) {
  assertCents(faceCents, 'faceCents');
  assertCents(paymentFeeFixedCents, 'paymentFeeFixedCents');
  assertCents(discountCents, 'discountCents');
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }
  if (feeBearer !== FEE_BEARER.BUYER && feeBearer !== FEE_BEARER.ORGANIZER) {
    throw new TypeError(`feeBearer must be "buyer" or "organizer", got "${feeBearer}"`);
  }

  const grossCents = faceCents * quantity;
  // A discount can never make the subtotal negative, and never exceeds gross.
  const discount = Math.min(Math.max(discountCents, 0), grossCents);
  const subtotalCents = grossCents - discount;

  // Tax and commission are both computed on the DISCOUNTED subtotal: a promo
  // reduces what the buyer owes in tax and what we earn, which is what both a
  // tax authority and an organizer expect.
  const eventTaxCents = pctOf(subtotalCents, eventTaxPct);
  const commissionCents = pctOf(subtotalCents, commissionPct);
  const commissionTaxCents = pctOf(commissionCents, commissionTaxPct);

  // Free tickets carry no fees at all (BRD §14). Guarding on the subtotal
  // rather than on the face price also covers a promo code that zeroes it.
  const isFree = subtotalCents === 0;

  let paymentFeeCents;
  if (isFree) {
    paymentFeeCents = 0;
  } else if (paymentFeeMode === PAYMENT_FEE_MODE.AUTO) {
    paymentFeeCents = autoPaymentFeeCents({
      subtotalCents, eventTaxCents, feeBearer, stripe,
    });
  } else {
    paymentFeeCents = pctOf(subtotalCents, paymentFeePct) + paymentFeeFixedCents;
  }

  // The buyer only ever sees the payment fee when they are the one bearing it.
  // The commission is invisible to them in both modes — it is deducted from the
  // organizer's proceeds, never added on top.
  const buyerTotalCents =
    feeBearer === FEE_BEARER.BUYER
      ? subtotalCents + eventTaxCents + paymentFeeCents
      : subtotalCents + eventTaxCents;

  // What Stripe hands us as `application_fee_amount`. Identical in both modes —
  // the mode only changes who funded it.
  const applicationFeeCents = isFree
    ? 0
    : commissionCents + commissionTaxCents + paymentFeeCents;

  const organizerNetCents = buyerTotalCents - applicationFeeCents;

  // ── The reality check ──
  const stripeCost = isFree ? 0 : stripeCostCents(buyerTotalCents, stripe);

  /**
   * What we actually KEEP.
   *
   * The tax on our own commission is subtracted, because it is not ours: we
   * collect it inside `application_fee_amount` and owe it onward. Leaving it in
   * overstates margin by exactly the commission tax rate — at 13% that is a 13%
   * flattering error on every order, and it would make `belowCost` report a
   * healthy margin on an order that is quietly under water.
   */
  const platformNetCents = applicationFeeCents - stripeCost - commissionTaxCents;
  // What we MEANT to earn: the commission itself, and nothing else.
  const intendedMarginCents = commissionCents;

  return {
    quantity,
    faceCents,
    grossCents,
    discountCents: discount,
    subtotalCents,

    eventTaxCents,
    commissionCents,
    commissionTaxCents,
    paymentFeeCents,
    paymentFeeMode,
    feeBearer,

    buyerTotalCents,
    applicationFeeCents,
    organizerNetCents,

    stripeCostCents: stripeCost,
    platformNetCents,
    intendedMarginCents,

    /**
     * True when the configured payment fee failed to cover what Stripe billed,
     * so this order earned less than the commission promised.
     *
     * Not an error and not a block: an admin may knowingly run a promotional
     * rate. It is surfaced so the shortfall is visible in the row that causes
     * it, rather than in a monthly total three weeks later.
     */
    belowCost: !isFree && platformNetCents < intendedMarginCents,
    /** Hard loss: we paid Stripe more than we collected in total. */
    lossMaking: !isFree && platformNetCents < 0,
  };
}

/**
 * The payment fee that would recover Stripe's cost EXACTLY, in buyer-pays mode.
 *
 * Solves the circularity: the fee is part of the total, and Stripe's percentage
 * is charged on that total, so the fee appears on both sides of its own
 * equation.
 *
 *   T   = subtotal + tax + fee
 *   fee = T·s_pct + s_fixed
 *   ⇒ T = (subtotal + tax + s_fixed) / (1 − s_pct)
 *
 * Use this to set `paymentFeePct` / `paymentFeeFixedCents` from evidence. In
 * organizer-pays mode the fee is not in the total, so the naive
 * `stripeCostCents(subtotal + tax)` is already exact.
 */
function solvePaymentFeeCents({ subtotalCents, eventTaxCents = 0, stripe }) {
  assertCents(subtotalCents, 'subtotalCents');
  assertCents(eventTaxCents, 'eventTaxCents');
  if (subtotalCents <= 0) return 0;

  const base = subtotalCents + eventTaxCents + stripe.fixedCents;
  const totalCents = Math.round(base / (1 - Number(stripe.pct) / 100));
  return totalCents - subtotalCents - eventTaxCents;
}

/**
 * What a fee configuration actually does, priced out — for the admin screen.
 *
 * An admin setting "2.9% + $0.30" has no way to know, from those numbers alone,
 * that a $20 ticket earns a different margin from a $200 one, or that turning
 * on a 13% tax quietly moves both. This answers the only question that matters
 * — "if I save this, what do we earn?" — as a table they can read, at the
 * moment of the decision rather than in next month's total.
 *
 * `recommended` is what AUTO mode would charge at each price. The gap between
 * that and the configured fee IS the shortfall, made explicit.
 *
 * @returns {{ mode, feeBearer, rows: Array, anyBelowCost: boolean, anyLossMaking: boolean }}
 */
function describeFeeConfig({
  mode = PAYMENT_FEE_MODE.AUTO,
  paymentFeePct = 0,
  paymentFeeFixedCents = 0,
  commissionPct = 0,
  commissionTaxPct = 0,
  eventTaxPct = 0,
  feeBearer = FEE_BEARER.BUYER,
  stripe,
  samplePricesCents = [1000, 2500, 5000, 10000, 25000],
}) {
  const rows = samplePricesCents.map((faceCents) => {
    const r = describeOrder({
      faceCents,
      eventTaxPct,
      commissionPct,
      commissionTaxPct,
      paymentFeeMode: mode,
      paymentFeePct,
      paymentFeeFixedCents,
      feeBearer,
      stripe,
    });

    // What AUTO would have charged here — the break-even reference point.
    const recommendedFeeCents = autoPaymentFeeCents({
      subtotalCents: r.subtotalCents,
      eventTaxCents: r.eventTaxCents,
      feeBearer,
      stripe,
    });

    return {
      faceCents,
      buyerTotalCents: r.buyerTotalCents,
      paymentFeeCents: r.paymentFeeCents,
      recommendedFeeCents,
      // Positive when the configured fee under-charges against break-even.
      feeGapCents: recommendedFeeCents - r.paymentFeeCents,
      commissionCents: r.commissionCents,
      stripeCostCents: r.stripeCostCents,
      platformNetCents: r.platformNetCents,
      // How far the real margin lands from the commission we advertised.
      marginGapCents: r.intendedMarginCents - r.platformNetCents,
      belowCost: r.belowCost,
      lossMaking: r.lossMaking,
    };
  });

  return {
    mode,
    feeBearer,
    rows,
    anyBelowCost: rows.some((r) => r.belowCost),
    anyLossMaking: rows.some((r) => r.lossMaking),
  };
}

module.exports = {
  assertCents,
  pctOf,
  formatCents,
  parseAmountToCents,
  stripeCostCents,
  solvePaymentFeeCents,
  autoPaymentFeeCents,
  describeOrder,
  describeFeeConfig,
  FEE_BEARER,
  PAYMENT_FEE_MODE,
};
