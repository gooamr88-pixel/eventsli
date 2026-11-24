const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  commissionCents, describeOrder, feesFromEvent, priceSale, commissionExamples, shapeEventFees,
  CHARGE_MODEL, FEE_BEARER,
} = require('../utils/fees');
const money = require('../utils/money');

/**
 * COMMISSION AS A PERCENTAGE PLUS A FIXED AMOUNT PER PAID TICKET, and every
 * fee in one file (owner, 2026-11-24).
 */

test('the commission is the percentage plus the fixed amount for each paid ticket', () => {
  // 1.5% of $100 = $1.50, + $0.50 × 2 tickets = $2.50
  assert.equal(commissionCents({ subtotalCents: 10000, paidTickets: 2, pct: 1.5, fixedCents: 50 }), 250);
  // percentage only, as every event before this change
  assert.equal(commissionCents({ subtotalCents: 10000, paidTickets: 2, pct: 1.5, fixedCents: 0 }), 150);
});

test('free tickets carry none, and it never exceeds the price', () => {
  assert.equal(commissionCents({ subtotalCents: 0, paidTickets: 0, pct: 1.5, fixedCents: 50 }), 0);
  // a $1 ticket with a $1.50 fixed part costs the organizer the ticket, not more
  assert.equal(commissionCents({ subtotalCents: 100, paidTickets: 1, pct: 10, fixedCents: 150 }), 100);
});

test('the breakdown carries it in both charge models, and the buyer never pays it', () => {
  for (const chargeModel of [CHARGE_MODEL.DIRECT, CHARGE_MODEL.DESTINATION]) {
    const b = describeOrder({
      faceCents: 5000, quantity: 1, paidTickets: 2, commissionPct: 2, commissionFixedCents: 75,
      commissionTaxPct: 10, feeBearer: FEE_BEARER.ORGANIZER, paymentFeeMode: 'manual', chargeModel,
    });
    assert.equal(b.commissionCents, 100 + 150, chargeModel); // 2% of 50.00 + 0.75 × 2
    assert.equal(b.commissionTaxCents, 25, chargeModel);
    assert.equal(b.buyerTotalCents, 5000, `${chargeModel}: not added to the buyer's total`);
    assert.equal(b.organizerNetCents, 5000 - 275, chargeModel);
  }
});

test('without a ticket count, a priced line counts its quantity', () => {
  const b = describeOrder({ faceCents: 2000, quantity: 3, commissionPct: 0, commissionFixedCents: 100 });
  assert.equal(b.commissionCents, 300);
});

test('an event row becomes one fee setup; a door or offline sale has no card fee', () => {
  const event = {
    commission_pct: '1.5', commission_fixed_cents: 50, commission_tax_pct: '13', event_tax_pct: '0',
    payment_fee_mode: 'auto', payment_fee_pct: '2.9', payment_fee_fixed_cents: 30, fee_bearer: 'buyer',
  };
  const card = feesFromEvent(event);
  assert.equal(card.commissionFixedCents, 50);
  assert.equal(card.feeBearer, FEE_BEARER.BUYER);
  const door = feesFromEvent(event, { channel: 'door' });
  assert.equal(door.paymentFeePct, 0);
  assert.equal(door.feeBearer, FEE_BEARER.ORGANIZER);

  const sale = priceSale({ fees: door, subtotalCents: 10000, paidTickets: 4, stripe: { pct: 2.9, fixedCents: 30 } });
  assert.equal(sale.paymentFeeCents, 0, 'no card, no card fee');
  assert.equal(sale.stripeCostCents, 0);
  assert.equal(sale.commissionCents, 150 + 200);
  assert.equal(shapeEventFees(event).commissionFixedCents, 50);
});

test('the examples an organizer sees before creating an event are the amounts charged', () => {
  const [ten, free] = [
    commissionExamples({ commissionPct: 1.5, commissionFixedCents: 50, commissionTaxPct: 0, pricesCents: [1000] })[0],
    commissionExamples({ commissionPct: 1.5, commissionFixedCents: 50, pricesCents: [0] })[0],
  ];
  assert.deepEqual(ten, { priceCents: 1000, commissionCents: 65, commissionTaxCents: 0, youKeepCents: 935 });
  assert.equal(
    ten.commissionCents,
    priceSale({ fees: feesFromEvent({ commission_pct: 1.5, commission_fixed_cents: 50 }, { channel: 'door' }), subtotalCents: 1000, paidTickets: 1 }).commissionCents,
  );
  assert.equal(free.commissionCents, 0);
});

test('money.js still hands out the fee functions, for older imports', () => {
  assert.equal(money.describeOrder, describeOrder);
  assert.equal(money.FEE_BEARER, FEE_BEARER);
});
