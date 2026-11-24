/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FEES — every charge on a sale, worked out in this one file (owner,
 * 2026-11-24: "connect all fee calculations and create a separate fees file").
 *
 * Every price on Eventsli runs through here: the card checkout and the pay-the-
 * organizer reservation (pricingService), the door sale (manualPaymentService),
 * the organizer's publish preview (submissionService), the admin's fee screen
 * (settingsController) and the commission an organizer is shown BEFORE they
 * create an event (feeService.termsFor). They used to each read an event's
 * rates on their own and hand them to the maths; now they all call
 * `feesFromEvent` for the rates and `priceSale` for the amounts, so a new fee
 * rule is written once and every screen and every charge agrees.
 *
 * `money.js` keeps the cent primitives (integers only, rounding, formatting)
 * and re-exports these names, so older imports keep working.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE FOUR MONEY ITEMS, AND WHY THEY ARE FOUR AND NOT ONE
 *
 *   1. FACE          the ticket price the organizer set.
 *   2. EVENT TAX     % on the face, set by the admin per event/country.
 *                    The ORGANIZER remits this — it passes through us untouched.
 *   3. COMMISSION    Eventsli's cut, set by the admin per event: a PERCENTAGE
 *                    of the price PLUS a FIXED AMOUNT PER PAID TICKET (owner,
 *                    2026-11-24), e.g. "1.5% + $0.50 per ticket". Always borne
 *                    by the ORGANIZER: never added to the buyer's total.
 *                    Free tickets carry none, and it never exceeds the price.
 *   4. PAYMENT FEE   % + fixed, set by the admin. The ORGANIZER chooses per
 *                    event whether the BUYER or the ORGANIZER bears it.
 *
 * Commission and payment fee are deliberately independent (BRD §04, §05). The
 * commission is margin; the payment fee exists to recover what the card network
 * costs. Collapsing them into one number is how you end up unable to answer
 * "did that sale actually make money?".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS MODULE EXISTS TO PREVENT (destination charges)
 *
 * On a DESTINATION charge the charge is created on the platform account,
 * `application_fee_amount` is our slice, and Stripe's own processing fee is
 * billed to the PLATFORM. Stripe charges its percentage on the FULL buyer
 * total, which includes the event tax AND the payment fee itself, so a payment
 * fee of "2.9% + $0.30 of the ticket price" under-covers on every order:
 *
 *   $100 ticket, 13% tax, payment fee configured as 2.9% + $0.30:
 *     payment fee charged .... $3.20   (2.9% of 100, + 0.30)
 *     buyer total ............ $116.20 (100 + 13 + 3.20)
 *     Stripe actually bills us  $3.67   (2.9% of 116.20, + 0.30)
 *
 * `describeOrder` therefore always computes the REAL Stripe cost alongside the
 * configured fee and reports `platformNetCents` and `belowCost`;
 * `solvePaymentFeeCents` gives the fee that breaks even exactly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { assertCents, pctOf } = require('./money');

/** Who pays the payment fee. Chosen by the organizer, per event. */
const FEE_BEARER = Object.freeze({ BUYER: 'buyer', ORGANIZER: 'organizer' });

/**
 * How the payment fee is arrived at. Set by the admin, per event.
 *   AUTO   the fee that recovers exactly what Stripe bills for THIS order.
 *   MANUAL the pct/fixed an admin entered; the shortfall is reported, never
 *          silently corrected.
 */
const PAYMENT_FEE_MODE = Object.freeze({ AUTO: 'auto', MANUAL: 'manual' });

/**
 * Whose charge it is (TECH-AUDIT-LOG T-074).
 *   DIRECT       the card checkout: the charge is on the organizer's own
 *                Stripe account, Stripe bills its fee to THEM, and Eventsli's
 *                application fee is its commission and the tax on it.
 *   DESTINATION  the old card model, kept for the orders it produced and for
 *                the callers that price without a card (door, offline).
 */
const CHARGE_MODEL = Object.freeze({ DIRECT: 'direct', DESTINATION: 'destination' });

/** The event columns every fee calculation reads. Select these, then `feesFromEvent`. */
const EVENT_FEE_COLUMNS = 'commission_pct, commission_fixed_cents, commission_tax_pct, event_tax_pct, '
  + 'payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, fee_bearer';

const NO_CARD = Object.freeze({ pct: 0, fixedCents: 0 });

/** Stripe's actual cost for a charge of `totalCents`. Rates live in settings. */
function stripeCostCents(totalCents, { pct, fixedCents }) {
  assertCents(totalCents, 'totalCents');
  assertCents(fixedCents, 'stripe.fixedCents');
  if (totalCents <= 0) return 0;
  return pctOf(totalCents, pct) + fixedCents;
}

/**
 * EVENTSLI'S COMMISSION on an order: the percentage of the subtotal plus the
 * fixed amount for each PAID ticket (owner, 2026-11-24). Never more than the
 * subtotal itself — a $1 ticket with a $1.50 fixed part costs the organizer
 * the ticket, not more than it — and nothing at all on a free order.
 */
function commissionCents({ subtotalCents, paidTickets = 1, pct = 0, fixedCents = 0 }) {
  assertCents(subtotalCents, 'subtotalCents');
  assertCents(fixedCents, 'commissionFixedCents');
  if (subtotalCents <= 0) return 0;
  const tickets = Math.max(0, Math.floor(Number(paidTickets) || 0));
  return Math.min(subtotalCents, pctOf(subtotalCents, pct) + fixedCents * tickets);
}

/**
 * The payment fee that would recover Stripe's cost EXACTLY, in buyer-pays mode.
 * The fee is part of the total Stripe takes its percentage of, so it appears
 * on both sides of its own equation:
 *   T = (subtotal + tax + s_fixed) / (1 − s_pct)
 */
function solvePaymentFeeCents({ subtotalCents, eventTaxCents = 0, stripe }) {
  assertCents(subtotalCents, 'subtotalCents');
  assertCents(eventTaxCents, 'eventTaxCents');
  if (subtotalCents <= 0) return 0;
  const base = subtotalCents + eventTaxCents + stripe.fixedCents;
  const totalCents = Math.round(base / (1 - Number(stripe.pct) / 100));
  return totalCents - subtotalCents - eventTaxCents;
}

/** The fee that recovers Stripe's cost exactly, for a given bearer. */
function autoPaymentFeeCents({ subtotalCents, eventTaxCents, feeBearer, stripe }) {
  if (subtotalCents <= 0) return 0;
  return feeBearer === FEE_BEARER.BUYER
    ? solvePaymentFeeCents({ subtotalCents, eventTaxCents, stripe })
    : stripeCostCents(subtotalCents + eventTaxCents, stripe);
}

function checkInputs({ faceCents, quantity, paymentFeeFixedCents, discountCents, feeBearer }) {
  assertCents(faceCents, 'faceCents');
  assertCents(paymentFeeFixedCents, 'paymentFeeFixedCents');
  assertCents(discountCents, 'discountCents');
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }
  if (feeBearer !== FEE_BEARER.BUYER && feeBearer !== FEE_BEARER.ORGANIZER) {
    throw new TypeError(`feeBearer must be "buyer" or "organizer", got "${feeBearer}"`);
  }
}

/**
 * The order, priced as a DIRECT charge on the organizer's own account.
 *   buyerTotal      subtotal + event tax (+ the service fee, when the buyer bears it)
 *   applicationFee  commission + commission tax          → Eventsli
 *   stripeCost      Stripe's processing fee              → the ORGANIZER
 *   organizerNet    buyerTotal − applicationFee − stripeCost
 */
function describeDirectOrder(o) {
  const {
    faceCents, quantity, eventTaxPct, commissionPct, commissionFixedCents, paidTickets, commissionTaxPct,
    paymentFeeMode, paymentFeePct, paymentFeeFixedCents, feeBearer, stripe, discountCents,
  } = o;
  checkInputs(o);

  const grossCents = faceCents * quantity;
  const discount = Math.min(Math.max(discountCents, 0), grossCents);
  const subtotalCents = grossCents - discount;
  const eventTaxCents = pctOf(subtotalCents, eventTaxPct);
  const commission = commissionCents({ subtotalCents, paidTickets, pct: commissionPct, fixedCents: commissionFixedCents });
  const commissionTaxCents = pctOf(commission, commissionTaxPct);
  const isFree = subtotalCents === 0;

  let paymentFeeCents = 0;
  if (!isFree && feeBearer === FEE_BEARER.BUYER) {
    paymentFeeCents = paymentFeeMode === PAYMENT_FEE_MODE.AUTO
      ? solvePaymentFeeCents({ subtotalCents, eventTaxCents, stripe })
      : pctOf(subtotalCents, paymentFeePct) + paymentFeeFixedCents;
  }

  const buyerTotalCents = subtotalCents + eventTaxCents + paymentFeeCents;
  const applicationFeeCents = isFree ? 0 : commission + commissionTaxCents;
  const stripeCost = isFree ? 0 : stripeCostCents(buyerTotalCents, stripe);
  // Never below zero: orders.organizer_net_cents is constrained >= 0.
  const organizerNetCents = Math.max(0, buyerTotalCents - applicationFeeCents - stripeCost);
  const platformNetCents = applicationFeeCents - commissionTaxCents;

  return {
    chargeModel: CHARGE_MODEL.DIRECT,
    quantity,
    faceCents,
    grossCents,
    discountCents: discount,
    subtotalCents,
    eventTaxCents,
    commissionCents: commission,
    commissionTaxCents,
    paymentFeeCents,
    paymentFeeMode,
    feeBearer,
    buyerTotalCents,
    applicationFeeCents,
    organizerNetCents,
    stripeCostCents: stripeCost,
    stripeCostBorneBy: 'organizer',
    platformNetCents,
    intendedMarginCents: commission,
    belowCost: false,
    lossMaking: false,
  };
}

/**
 * THE single authoritative breakdown for an order.
 *
 * @param {object}  o
 * @param {number}  o.faceCents             the price, in cents (a whole order's
 *                                          subtotal when quantity is 1)
 * @param {number}  o.quantity              number of units at that price (>= 1)
 * @param {number}  o.paidTickets           tickets with a price, for the fixed
 *                                          commission (defaults to `quantity`)
 * @param {number}  o.eventTaxPct           tax on the ticket; organizer remits
 * @param {number}  o.commissionPct         Eventsli's percentage
 * @param {number}  o.commissionFixedCents  Eventsli's fixed amount per paid ticket
 * @param {number}  o.commissionTaxPct      tax on OUR commission; we remit
 * @param {number}  o.paymentFeePct         admin-set, applied to the subtotal
 * @param {number}  o.paymentFeeFixedCents  admin-set, per ORDER — it mirrors
 *                                          Stripe's per-CHARGE fixed cost
 * @param {string}  o.feeBearer             FEE_BEARER.BUYER | FEE_BEARER.ORGANIZER
 * @param {object}  o.stripe                { pct, fixedCents } — real cost model
 * @param {number} [o.discountCents=0]      promo discount, applied to the subtotal
 */
function describeOrder({
  faceCents,
  quantity = 1,
  paidTickets,
  eventTaxPct = 0,
  commissionPct = 0,
  commissionFixedCents = 0,
  commissionTaxPct = 0,
  paymentFeeMode = PAYMENT_FEE_MODE.AUTO,
  paymentFeePct = 0,
  paymentFeeFixedCents = 0,
  feeBearer = FEE_BEARER.BUYER,
  stripe = NO_CARD,
  discountCents = 0,
  chargeModel = CHARGE_MODEL.DESTINATION,
}) {
  const fixed = Number(commissionFixedCents) || 0;
  const tickets = paidTickets === undefined || paidTickets === null
    ? (faceCents > 0 ? quantity : 0) : paidTickets;
  const args = {
    faceCents, quantity, paidTickets: tickets, eventTaxPct, commissionPct, commissionFixedCents: fixed,
    commissionTaxPct, paymentFeeMode, paymentFeePct, paymentFeeFixedCents, feeBearer, stripe, discountCents,
  };
  if (chargeModel === CHARGE_MODEL.DIRECT) return describeDirectOrder(args);
  checkInputs(args);

  const grossCents = faceCents * quantity;
  // A discount can never make the subtotal negative, and never exceeds gross.
  const discount = Math.min(Math.max(discountCents, 0), grossCents);
  const subtotalCents = grossCents - discount;

  // Tax and commission are both computed on the DISCOUNTED subtotal.
  const eventTaxCents = pctOf(subtotalCents, eventTaxPct);
  const commission = commissionCents({ subtotalCents, paidTickets: tickets, pct: commissionPct, fixedCents: fixed });
  const commissionTaxCents = pctOf(commission, commissionTaxPct);

  // Free tickets carry no fees at all (BRD §14), and a promo that zeroes the
  // subtotal counts as free.
  const isFree = subtotalCents === 0;

  let paymentFeeCents;
  if (isFree) {
    paymentFeeCents = 0;
  } else if (paymentFeeMode === PAYMENT_FEE_MODE.AUTO) {
    paymentFeeCents = autoPaymentFeeCents({ subtotalCents, eventTaxCents, feeBearer, stripe });
  } else {
    paymentFeeCents = pctOf(subtotalCents, paymentFeePct) + paymentFeeFixedCents;
  }

  // The buyer only ever sees the payment fee when they are the one bearing it.
  const buyerTotalCents = feeBearer === FEE_BEARER.BUYER
    ? subtotalCents + eventTaxCents + paymentFeeCents
    : subtotalCents + eventTaxCents;

  const applicationFeeCents = isFree ? 0 : commission + commissionTaxCents + paymentFeeCents;
  const organizerNetCents = buyerTotalCents - applicationFeeCents;

  // ── The reality check ──
  const stripeCost = isFree ? 0 : stripeCostCents(buyerTotalCents, stripe);
  // What we actually KEEP: the tax on our commission is owed onward, not ours.
  const platformNetCents = applicationFeeCents - stripeCost - commissionTaxCents;
  const intendedMarginCents = commission;

  return {
    quantity,
    faceCents,
    grossCents,
    discountCents: discount,
    subtotalCents,
    eventTaxCents,
    commissionCents: commission,
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
    /** The configured payment fee failed to cover what Stripe billed. */
    belowCost: !isFree && platformNetCents < intendedMarginCents,
    /** Hard loss: we paid Stripe more than we collected in total. */
    lossMaking: !isFree && platformNetCents < 0,
  };
}

/**
 * AN EVENT'S RATES, read from its row (select EVENT_FEE_COLUMNS), in the one
 * shape every calculation takes. `channel` says how the sale is paid:
 *   'card'     the checkout — the event's own payment fee and bearer;
 *   'offline'  the buyer pays the organizer directly, and
 *   'door'     the organizer took the money themselves: no card, so no
 *              payment fee to recover, borne by nobody. Commission and tax
 *              are unchanged in every channel.
 */
function feesFromEvent(event = {}, { channel = 'card' } = {}) {
  const noCard = channel !== 'card';
  return {
    commissionPct: Number(event.commission_pct) || 0,
    commissionFixedCents: Number(event.commission_fixed_cents) || 0,
    commissionTaxPct: Number(event.commission_tax_pct) || 0,
    eventTaxPct: Number(event.event_tax_pct) || 0,
    paymentFeeMode: noCard || event.payment_fee_mode === 'manual' ? PAYMENT_FEE_MODE.MANUAL : PAYMENT_FEE_MODE.AUTO,
    paymentFeePct: noCard ? 0 : Number(event.payment_fee_pct) || 0,
    paymentFeeFixedCents: noCard ? 0 : Number(event.payment_fee_fixed_cents) || 0,
    feeBearer: noCard || event.fee_bearer === 'organizer' ? FEE_BEARER.ORGANIZER : FEE_BEARER.BUYER,
    noCard,
  };
}

/**
 * A SALE, PRICED: the one call every checkout, door sale and preview makes.
 *   fees          from `feesFromEvent`
 *   subtotalCents the order's price before discount (tickets + add-ons)
 *   paidTickets   how many tickets in it have a price (fixed commission)
 */
function priceSale({ fees, subtotalCents, paidTickets, discountCents = 0, stripe = NO_CARD, chargeModel = CHARGE_MODEL.DESTINATION }) {
  return describeOrder({
    faceCents: subtotalCents,
    // The order is ONE charge: the payment fee's fixed part mirrors Stripe's
    // per-CHARGE cost, so it is never multiplied by the party size.
    quantity: 1,
    paidTickets,
    eventTaxPct: fees.eventTaxPct,
    commissionPct: fees.commissionPct,
    commissionFixedCents: fees.commissionFixedCents,
    commissionTaxPct: fees.commissionTaxPct,
    paymentFeeMode: fees.paymentFeeMode,
    paymentFeePct: fees.paymentFeePct,
    paymentFeeFixedCents: fees.paymentFeeFixedCents,
    feeBearer: fees.feeBearer,
    stripe: fees.noCard ? NO_CARD : stripe,
    discountCents,
    // No card, no card charge: the plain breakdown with every card cost at zero.
    chargeModel: fees.noCard ? CHARGE_MODEL.DESTINATION : chargeModel,
  });
}

/** An event's rates for an API response (camelCase), the organizer's and the admin's. */
function shapeEventFees(event = {}) {
  return {
    commissionPct: Number(event.commission_pct) || 0,
    commissionFixedCents: Number(event.commission_fixed_cents) || 0,
    commissionTaxPct: Number(event.commission_tax_pct) || 0,
    paymentFeeMode: event.payment_fee_mode,
    paymentFeePct: Number(event.payment_fee_pct) || 0,
    paymentFeeFixedCents: Number(event.payment_fee_fixed_cents) || 0,
    feeBearer: event.fee_bearer,
    eventTaxPct: Number(event.event_tax_pct) || 0,
  };
}

/**
 * What a fee configuration actually does, priced out — for the admin screen.
 * One ticket per row; `recommended` is what AUTO would charge, so the gap is
 * the shortfall made explicit.
 */
function describeFeeConfig({
  mode = PAYMENT_FEE_MODE.AUTO,
  paymentFeePct = 0,
  paymentFeeFixedCents = 0,
  commissionPct = 0,
  commissionFixedCents = 0,
  commissionTaxPct = 0,
  eventTaxPct = 0,
  feeBearer = FEE_BEARER.BUYER,
  stripe,
  samplePricesCents = [1000, 2500, 5000, 10000, 25000],
}) {
  const rows = samplePricesCents.map((faceCents) => {
    const r = describeOrder({
      faceCents, eventTaxPct, commissionPct, commissionFixedCents, commissionTaxPct,
      paymentFeeMode: mode, paymentFeePct, paymentFeeFixedCents, feeBearer, stripe,
    });
    const recommendedFeeCents = autoPaymentFeeCents({
      subtotalCents: r.subtotalCents, eventTaxCents: r.eventTaxCents, feeBearer, stripe,
    });
    return {
      faceCents,
      buyerTotalCents: r.buyerTotalCents,
      paymentFeeCents: r.paymentFeeCents,
      recommendedFeeCents,
      feeGapCents: recommendedFeeCents - r.paymentFeeCents,
      commissionCents: r.commissionCents,
      stripeCostCents: r.stripeCostCents,
      platformNetCents: r.platformNetCents,
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

/**
 * THE COMMISSION, FOR ONE TICKET AT EACH PRICE — what an organizer is shown
 * before creating an event (owner, 2026-11-24: "show the organizer the exact
 * commission before event creation"). Commission and its tax only: the card
 * fee depends on the organizer's own Stripe pricing and on who bears it, and
 * is shown where that is chosen.
 */
function commissionExamples({ commissionPct = 0, commissionFixedCents = 0, commissionTaxPct = 0, pricesCents }) {
  return pricesCents.map((priceCents) => {
    const commission = commissionCents({
      subtotalCents: priceCents, paidTickets: priceCents > 0 ? 1 : 0, pct: commissionPct, fixedCents: commissionFixedCents,
    });
    const tax = pctOf(commission, commissionTaxPct);
    return { priceCents, commissionCents: commission, commissionTaxCents: tax, youKeepCents: priceCents - commission - tax };
  });
}

module.exports = {
  FEE_BEARER,
  PAYMENT_FEE_MODE,
  CHARGE_MODEL,
  EVENT_FEE_COLUMNS,
  stripeCostCents,
  commissionCents,
  solvePaymentFeeCents,
  autoPaymentFeeCents,
  describeOrder,
  describeFeeConfig,
  feesFromEvent,
  priceSale,
  shapeEventFees,
  commissionExamples,
};
