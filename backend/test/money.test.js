const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  pctOf,
  parseAmountToCents,
  stripeCostCents,
  solvePaymentFeeCents,
  describeOrder,
  FEE_BEARER,
  PAYMENT_FEE_MODE,
} = require('../utils/money');

// Stripe's published card rate for the Canadian platform account. Kept here as
// the model the tests reason against; production reads it from config.
const STRIPE = { pct: 2.9, fixedCents: 30 };

// This file exercises the ARITHMETIC of a hand-entered fee, so every case here
// pins the mode to manual. Auto mode derives the fee instead of reading these
// numbers, and has its own file — paymentFeeMode.test.js.
const MANUAL = PAYMENT_FEE_MODE.MANUAL;

test('parseAmountToCents never routes through a float', () => {
  assert.equal(parseAmountToCents('19.99'), 1999);
  assert.equal(parseAmountToCents('100'), 10000);
  assert.equal(parseAmountToCents('1,299.50'), 129950);
  assert.equal(parseAmountToCents('0.07'), 7);
  assert.equal(parseAmountToCents('-5.25'), -525);
  assert.throws(() => parseAmountToCents('19.999'), TypeError);
  assert.throws(() => parseAmountToCents('abc'), TypeError);
});

test('pctOf is symmetric, so a reversal cancels its sale to exactly zero', () => {
  // Math.round would send -50 to -0 here and leave a cent behind in the ledger.
  assert.equal(pctOf(1000, 1.5) + pctOf(-1000, 1.5), 0);
  assert.equal(pctOf(333, 1.5) + pctOf(-333, 1.5), 0);
});

test('integer cents are enforced at the boundary', () => {
  assert.throws(() => describeOrder({ faceCents: 19.99, quantity: 1 }), TypeError);
});

// ── BRD §04 / §05 — the two fee modes ───────────────────────────────────────

test('buyer-pays: buyer sees the payment fee, never the commission', () => {
  const r = describeOrder({
    faceCents: 10000,          // $100.00
    eventTaxPct: 13,           // Ontario HST
    commissionPct: 1.5,        // Eventsli
    commissionTaxPct: 13,      // GST/HST on our own fee
    paymentFeeMode: MANUAL,
    paymentFeePct: 2.9,
    paymentFeeFixedCents: 30,
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });

  assert.equal(r.subtotalCents, 10000);
  assert.equal(r.eventTaxCents, 1300);
  assert.equal(r.commissionCents, 150);        // 1.5% of $100
  assert.equal(r.commissionTaxCents, 20);      // 13% of $1.50, rounded
  assert.equal(r.paymentFeeCents, 320);        // 2.9% of $100 + $0.30

  // The buyer pays ticket + tax + payment fee. The commission is invisible.
  assert.equal(r.buyerTotalCents, 11620);
  assert.equal(r.applicationFeeCents, 490);    // 150 + 20 + 320
  assert.equal(r.organizerNetCents, 11130);    // includes the $13 tax they remit
});

test('organizer-pays: the buyer total drops by exactly the payment fee', () => {
  const common = {
    faceCents: 10000,
    eventTaxPct: 13,
    commissionPct: 1.5,
    commissionTaxPct: 13,
    paymentFeeMode: MANUAL,
    paymentFeePct: 2.9,
    paymentFeeFixedCents: 30,
    stripe: STRIPE,
  };
  const buyerPays = describeOrder({ ...common, feeBearer: FEE_BEARER.BUYER });
  const orgPays = describeOrder({ ...common, feeBearer: FEE_BEARER.ORGANIZER });

  assert.equal(orgPays.buyerTotalCents, 11300);
  assert.equal(buyerPays.buyerTotalCents - orgPays.buyerTotalCents, orgPays.paymentFeeCents);

  // We collect the same amount either way — only the funder changes.
  assert.equal(orgPays.applicationFeeCents, buyerPays.applicationFeeCents);

  // The organizer absorbs it out of their proceeds.
  assert.equal(buyerPays.organizerNetCents - orgPays.organizerNetCents, orgPays.paymentFeeCents);
});

test('the commission is borne by the organizer in BOTH modes', () => {
  for (const feeBearer of [FEE_BEARER.BUYER, FEE_BEARER.ORGANIZER]) {
    const r = describeOrder({
      faceCents: 10000,
      commissionPct: 1.5,
      paymentFeeMode: MANUAL,
      feeBearer,
      stripe: STRIPE,
    });
    // Buyer total never contains the commission.
    assert.equal(r.buyerTotalCents % 100, 0, `${feeBearer}: commission leaked into buyer total`);
    // Organizer is down exactly the commission (no tax, no payment fee here).
    assert.equal(r.organizerNetCents, 10000 - r.commissionCents - r.paymentFeeCents);
  }
});

// ── The trap this module exists to prevent ──────────────────────────────────

test('a naively-configured payment fee under-recovers, and is flagged', () => {
  const r = describeOrder({
    faceCents: 10000,
    eventTaxPct: 13,
    commissionPct: 1.5,
    paymentFeeMode: MANUAL,
    paymentFeePct: 2.9,          // configured against the TICKET, not the total
    paymentFeeFixedCents: 30,
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });

  // Stripe bills 2.9% of the full $116.20 — including the tax and the fee.
  assert.equal(r.stripeCostCents, 367);
  assert.equal(r.applicationFeeCents, 470);
  assert.equal(r.platformNetCents, 103);      // we meant to earn 150

  assert.equal(r.belowCost, true, 'shortfall must be visible');
  assert.equal(r.lossMaking, false, 'still profitable, just short');
});

test('solvePaymentFeeCents recovers the commission exactly', () => {
  const subtotalCents = 10000;
  const eventTaxCents = 1300;

  const fee = solvePaymentFeeCents({ subtotalCents, eventTaxCents, stripe: STRIPE });

  const r = describeOrder({
    faceCents: subtotalCents,
    eventTaxPct: 13,
    commissionPct: 1.5,
    paymentFeeMode: MANUAL,
    paymentFeePct: 0,
    paymentFeeFixedCents: fee,   // the solved amount, as a flat charge
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });

  assert.equal(r.paymentFeeCents, fee);
  assert.equal(r.stripeCostCents, fee, 'the fee must equal what Stripe bills');
  assert.equal(r.platformNetCents, r.intendedMarginCents, 'we net exactly the commission');
  assert.equal(r.belowCost, false);
});

test('the solved fee stays exact across price points', () => {
  for (const faceCents of [2000, 5000, 10000, 25000, 100000]) {
    const eventTaxCents = pctOf(faceCents, 13);
    const fee = solvePaymentFeeCents({ subtotalCents: faceCents, eventTaxCents, stripe: STRIPE });
    const total = faceCents + eventTaxCents + fee;
    // Allow one cent of rounding slack — the solve rounds the total, not the fee.
    assert.ok(
      Math.abs(stripeCostCents(total, STRIPE) - fee) <= 1,
      `face ${faceCents}: fee ${fee} vs stripe ${stripeCostCents(total, STRIPE)}`,
    );
  }
});

// ── BRD §14 — free events ───────────────────────────────────────────────────

test('a free ticket carries no commission, no fee, and never reaches Stripe', () => {
  const r = describeOrder({
    faceCents: 0,
    eventTaxPct: 13,
    commissionPct: 1.5,
    paymentFeeMode: MANUAL,
    paymentFeePct: 2.9,
    paymentFeeFixedCents: 30,
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });
  assert.equal(r.buyerTotalCents, 0);
  assert.equal(r.applicationFeeCents, 0);
  assert.equal(r.paymentFeeCents, 0);
  assert.equal(r.stripeCostCents, 0);
  assert.equal(r.belowCost, false);
});

test('a promo that zeroes the subtotal is treated as free', () => {
  const r = describeOrder({
    faceCents: 5000,
    discountCents: 5000,
    commissionPct: 1.5,
    paymentFeeMode: MANUAL,
    paymentFeePct: 2.9,
    paymentFeeFixedCents: 30,
    stripe: STRIPE,
  });
  assert.equal(r.subtotalCents, 0);
  assert.equal(r.buyerTotalCents, 0);
  assert.equal(r.applicationFeeCents, 0);
});

test('a discount can never exceed the gross or go negative', () => {
  const over = describeOrder({ faceCents: 5000, discountCents: 9999, stripe: STRIPE });
  assert.equal(over.discountCents, 5000);
  assert.equal(over.subtotalCents, 0);

  const negative = describeOrder({ faceCents: 5000, discountCents: -100, stripe: STRIPE });
  assert.equal(negative.discountCents, 0);
  assert.equal(negative.subtotalCents, 5000);
});

// ── BRD §11 — multi-ticket orders ───────────────────────────────────────────

test('the fixed fee is charged once per ORDER, mirroring Stripe', () => {
  const one = describeOrder({
    faceCents: 5000, quantity: 1,
    paymentFeeMode: MANUAL,
    paymentFeePct: 0, paymentFeeFixedCents: 30,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  });
  const ten = describeOrder({
    faceCents: 5000, quantity: 10,
    paymentFeeMode: MANUAL,
    paymentFeePct: 0, paymentFeeFixedCents: 30,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  });

  assert.equal(one.paymentFeeCents, 30);
  assert.equal(ten.paymentFeeCents, 30, 'ten seats is still one charge');
  assert.equal(ten.subtotalCents, 50000);
});

test('the whole breakdown always balances', () => {
  for (const feeBearer of [FEE_BEARER.BUYER, FEE_BEARER.ORGANIZER]) {
    for (const quantity of [1, 3, 10]) {
      const r = describeOrder({
        faceCents: 7350, quantity,
        eventTaxPct: 5, commissionPct: 1.5, commissionTaxPct: 13,
        paymentFeeMode: MANUAL,
        paymentFeePct: 2.9, paymentFeeFixedCents: 30,
        feeBearer, stripe: STRIPE,
      });
      assert.equal(
        r.organizerNetCents + r.applicationFeeCents,
        r.buyerTotalCents,
        `${feeBearer} x${quantity}: organizer + platform must equal what the buyer paid`,
      );
    }
  }
});
