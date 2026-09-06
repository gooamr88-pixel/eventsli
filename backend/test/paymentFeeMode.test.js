const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  describeOrder,
  describeFeeConfig,
  autoPaymentFeeCents,
  FEE_BEARER,
  PAYMENT_FEE_MODE,
} = require('../utils/money');

const STRIPE = { pct: 2.9, fixedCents: 30 };

// ── AUTO mode: the fee is always exactly what Stripe bills ──────────────────

test('auto + buyer-pays nets exactly the commission, at every price', () => {
  for (const faceCents of [1000, 2500, 5000, 10000, 25000, 100000]) {
    for (const eventTaxPct of [0, 5, 13, 15]) {
      const r = describeOrder({
        faceCents,
        eventTaxPct,
        commissionPct: 1.5,
        paymentFeeMode: PAYMENT_FEE_MODE.AUTO,
        feeBearer: FEE_BEARER.BUYER,
        stripe: STRIPE,
      });
      // One cent of slack: the solve rounds the total, not the fee itself.
      assert.ok(
        Math.abs(r.platformNetCents - r.intendedMarginCents) <= 1,
        `face ${faceCents} tax ${eventTaxPct}%: net ${r.platformNetCents} vs commission ${r.intendedMarginCents}`,
      );
      assert.equal(r.belowCost, false);
    }
  }
});

test('auto + organizer-pays nets exactly the commission too', () => {
  for (const faceCents of [1000, 5000, 25000]) {
    const r = describeOrder({
      faceCents,
      eventTaxPct: 13,
      commissionPct: 1.5,
      paymentFeeMode: PAYMENT_FEE_MODE.AUTO,
      feeBearer: FEE_BEARER.ORGANIZER,
      stripe: STRIPE,
    });
    assert.equal(r.stripeCostCents, r.paymentFeeCents, 'fee must equal the real cost');
    assert.equal(r.platformNetCents, r.intendedMarginCents);
  }
});

test('the two bearers need genuinely different auto fees', () => {
  const args = { subtotalCents: 10000, eventTaxCents: 1300, stripe: STRIPE };
  const buyer = autoPaymentFeeCents({ ...args, feeBearer: FEE_BEARER.BUYER });
  const org = autoPaymentFeeCents({ ...args, feeBearer: FEE_BEARER.ORGANIZER });

  // Buyer-pays is larger: the fee is inside the total Stripe takes its cut of,
  // so it has to cover the cut on itself.
  assert.ok(buyer > org, `buyer ${buyer} should exceed organizer ${org}`);
  assert.equal(org, 358);   // 2.9% of $113.00 + $0.30
  assert.equal(buyer, 368); // solved so that fee == 2.9% of (113 + fee) + 0.30
});

test('auto ignores whatever pct/fixed happen to be stored', () => {
  const base = {
    faceCents: 10000, eventTaxPct: 13, commissionPct: 1.5,
    paymentFeeMode: PAYMENT_FEE_MODE.AUTO,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  };
  const withJunk = describeOrder({ ...base, paymentFeePct: 99, paymentFeeFixedCents: 9999 });
  const withZero = describeOrder({ ...base, paymentFeePct: 0, paymentFeeFixedCents: 0 });
  assert.equal(withJunk.paymentFeeCents, withZero.paymentFeeCents);
});

// ── MANUAL mode: the admin's numbers are honoured, never corrected ──────────

test('manual uses the entered numbers verbatim', () => {
  const r = describeOrder({
    faceCents: 10000, eventTaxPct: 13, commissionPct: 1.5,
    paymentFeeMode: PAYMENT_FEE_MODE.MANUAL,
    paymentFeePct: 2.0, paymentFeeFixedCents: 25,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  });
  assert.equal(r.paymentFeeCents, 225); // 2% of $100 + $0.25 — exactly as typed
  assert.equal(r.belowCost, true, 'under-charging must be flagged, not fixed');
});

test('a deliberately generous manual fee is allowed and reported', () => {
  const r = describeOrder({
    faceCents: 10000, commissionPct: 1.5,
    paymentFeeMode: PAYMENT_FEE_MODE.MANUAL,
    paymentFeePct: 5.0, paymentFeeFixedCents: 50,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  });
  assert.equal(r.paymentFeeCents, 550);
  assert.ok(r.platformNetCents > r.intendedMarginCents, 'over-charging earns more');
  assert.equal(r.belowCost, false);
});

test('a manual fee can be set low enough to lose real money, and says so', () => {
  const r = describeOrder({
    faceCents: 1000,                       // a $10 ticket
    paymentFeeMode: PAYMENT_FEE_MODE.MANUAL,
    paymentFeePct: 0, paymentFeeFixedCents: 5,   // 5c against a ~60c cost
    commissionPct: 1.5,
    feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
  });
  assert.ok(r.platformNetCents < 0, 'this order costs us money');
  assert.equal(r.lossMaking, true);
  assert.equal(r.belowCost, true);
});

// ── The admin screen ────────────────────────────────────────────────────────

test('describeFeeConfig prices a config out across the range', () => {
  const cfg = describeFeeConfig({
    mode: PAYMENT_FEE_MODE.MANUAL,
    paymentFeePct: 2.9,
    paymentFeeFixedCents: 30,
    commissionPct: 1.5,
    eventTaxPct: 13,
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });

  assert.equal(cfg.rows.length, 5);
  assert.equal(cfg.anyBelowCost, true, 'the classic misconfiguration must surface');

  for (const row of cfg.rows) {
    // The recommendation is always the break-even number.
    assert.ok(row.recommendedFeeCents > 0);
    // Configured against the ticket, not the total → always short.
    assert.ok(row.feeGapCents > 0, `face ${row.faceCents} should be under break-even`);

    // The margin gap is the distance from the commission we advertised.
    //
    // This line previously read `row.intendedGap ?? row.marginGapCents` — and
    // `intendedGap` is not a field, so the `??` fell through and the assertion
    // compared the value to ITSELF. It could never fail. An assertion shaped
    // like a guard that guards nothing is worse than none, because it reports
    // confidence it does not have.
    assert.equal(
      row.marginGapCents,
      row.commissionCents - row.platformNetCents,
      `face ${row.faceCents}: marginGap must be commission minus what we actually net`,
    );
    assert.ok(row.marginGapCents > 0, 'an under-set fee must show a positive gap');
  }
});

test('describeFeeConfig reports auto as clean at every price', () => {
  const cfg = describeFeeConfig({
    mode: PAYMENT_FEE_MODE.AUTO,
    commissionPct: 1.5,
    eventTaxPct: 13,
    feeBearer: FEE_BEARER.BUYER,
    stripe: STRIPE,
  });
  assert.equal(cfg.anyBelowCost, false);
  assert.equal(cfg.anyLossMaking, false);
  for (const row of cfg.rows) {
    assert.equal(row.feeGapCents, 0, 'auto IS the recommendation');
    assert.ok(Math.abs(row.marginGapCents) <= 1);
  }
});

test('free tickets stay free in both modes', () => {
  for (const mode of [PAYMENT_FEE_MODE.AUTO, PAYMENT_FEE_MODE.MANUAL]) {
    const r = describeOrder({
      faceCents: 0, eventTaxPct: 13, commissionPct: 1.5,
      paymentFeeMode: mode, paymentFeePct: 2.9, paymentFeeFixedCents: 30,
      feeBearer: FEE_BEARER.BUYER, stripe: STRIPE,
    });
    assert.equal(r.buyerTotalCents, 0);
    assert.equal(r.paymentFeeCents, 0);
    assert.equal(r.applicationFeeCents, 0);
  }
});
