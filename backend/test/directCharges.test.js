const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * The organizer is the merchant of record (TECH-AUDIT-LOG T-074).
 *
 *   connectModel.checkAccount  — the gate on every card checkout: an account
 *                                that would leave Eventsli liable is refused
 *   money describeDirectOrder  — Eventsli's fee is commission + its tax; the
 *                                Stripe fee is the organizer's
 */
const { checkAccount, accountCreateBody } = require('../services/connectModel');
const { describeOrder, CHARGE_MODEL, FEE_BEARER } = require('../utils/money');

const ORGANIZER_OWNED = {
  charges_enabled: true,
  payouts_enabled: true,
  controller: {
    losses: { payments: 'stripe' },
    fees: { payer: 'account' },
    requirement_collection: 'stripe',
    stripe_dashboard: { type: 'full' },
    type: 'application',
  },
};

test('an organizer-owned account with Stripe carrying losses may take payments', () => {
  assert.deepEqual(checkAccount(ORGANIZER_OWNED), { ok: true });
});

test('a legacy Express account (platform carries losses, platform pays Stripe) is refused', () => {
  // v1 `type: express` maps to exactly this (Stripe docs, migrate-to-controller-properties).
  const legacy = {
    ...ORGANIZER_OWNED,
    controller: {
      losses: { payments: 'application' }, fees: { payer: 'application' },
      requirement_collection: 'stripe', stripe_dashboard: { type: 'express' },
    },
  };
  const v = checkAccount(legacy);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'STRIPE_ACCOUNT_MODEL');
  assert.match(v.detail, /losses\.payments=application/);
  assert.match(v.detail, /fees\.payer=application/);
  assert.match(v.detail, /stripe_dashboard\.type=express/);
});

test('any single liability setting wrong is enough to refuse', () => {
  for (const [path, value] of [['losses', { payments: 'application' }], ['fees', { payer: 'application' }],
    ['stripe_dashboard', { type: 'none' }]]) {
    const a = { ...ORGANIZER_OWNED, controller: { ...ORGANIZER_OWNED.controller, [path]: value } };
    assert.equal(checkAccount(a).reason, 'STRIPE_ACCOUNT_MODEL', path);
  }
});

test('a correctly configured account that has not finished onboarding is "not active", not "wrong model"', () => {
  assert.equal(checkAccount({ ...ORGANIZER_OWNED, charges_enabled: false }).reason, 'STRIPE_NOT_ACTIVE');
  assert.equal(checkAccount({ ...ORGANIZER_OWNED, payouts_enabled: false }).reason, 'STRIPE_NOT_ACTIVE');
  assert.equal(checkAccount(null).reason, 'STRIPE_NOT_CONNECTED');
});

test('the v2 account body: full dashboard, Stripe collects fees AND losses, card payments, CA or US only', () => {
  const ca = accountCreateBody({ id: 'o1', country: 'CA', email: 'o@x.test', display_name: 'O' });
  assert.equal(ca.dashboard, 'full');
  assert.deepEqual(ca.defaults.responsibilities, { fees_collector: 'stripe', losses_collector: 'stripe' });
  assert.deepEqual(ca.configuration.merchant.capabilities, { card_payments: { requested: true } });
  assert.equal(ca.identity.country, 'ca');
  assert.equal(accountCreateBody({ id: 'o2', country: 'US' }).identity.country, 'us');
  assert.throws(() => accountCreateBody({ id: 'o3', country: 'GB' }), (e) => e.code === 'VALIDATION_ERROR');
});

const STRIPE = { pct: 2.9, fixedCents: 30 };
const base = {
  faceCents: 10000, eventTaxPct: 13, commissionPct: 1.5, commissionTaxPct: 13, stripe: STRIPE,
};

test('DIRECT, organizer bears the processing fee: the buyer pays face + tax, Eventsli takes commission + its tax', () => {
  const o = describeOrder({ ...base, feeBearer: FEE_BEARER.ORGANIZER, chargeModel: CHARGE_MODEL.DIRECT });
  assert.equal(o.chargeModel, 'direct');
  assert.equal(o.buyerTotalCents, 11300);           // 100 + 13 tax, no service fee
  assert.equal(o.paymentFeeCents, 0);               // nobody charges a separate fee
  assert.equal(o.commissionCents, 150);
  assert.equal(o.commissionTaxCents, 20);           // 13% of 1.50, rounded
  assert.equal(o.applicationFeeCents, 170);         // Eventsli's slice — and nothing else
  assert.equal(o.stripeCostCents, 358);             // 2.9% of 113.00 + 0.30, billed to the ORGANIZER
  assert.equal(o.stripeCostBorneBy, 'organizer');
  assert.equal(o.organizerNetCents, 11300 - 170 - 358);
  assert.equal(o.platformNetCents, 150);            // the commission; its tax is owed onward
  assert.equal(o.belowCost, false);
  assert.equal(o.lossMaking, false);
});

test('DIRECT, buyer bears the processing fee: the service fee covers Stripe and stays with the organizer', () => {
  const o = describeOrder({ ...base, feeBearer: FEE_BEARER.BUYER, chargeModel: CHARGE_MODEL.DIRECT });
  assert.ok(o.paymentFeeCents > 0);
  assert.equal(o.buyerTotalCents, 11300 + o.paymentFeeCents);
  assert.equal(o.applicationFeeCents, 170, 'the service fee is NOT part of Eventsli\'s fee');
  // Solved so Stripe's cut of the WHOLE total is covered (within a cent of rounding).
  assert.ok(Math.abs(o.paymentFeeCents - o.stripeCostCents) <= 1, `${o.paymentFeeCents} vs ${o.stripeCostCents}`);
  assert.ok(Math.abs(o.organizerNetCents - (11300 - 170)) <= 1, 'the organizer nets face + tax − our fee');
});

test('DIRECT and DESTINATION differ exactly where the model says they should', () => {
  const d = describeOrder({ ...base, feeBearer: FEE_BEARER.BUYER, chargeModel: CHARGE_MODEL.DIRECT });
  const legacy = describeOrder({ ...base, feeBearer: FEE_BEARER.BUYER });
  assert.equal(d.buyerTotalCents, legacy.buyerTotalCents, 'the buyer pays the same');
  assert.equal(legacy.applicationFeeCents, 170 + legacy.paymentFeeCents, 'legacy: the platform recovered its own Stripe cost');
  assert.equal(d.applicationFeeCents, 170, 'direct: no Stripe cost of ours to recover');
});

test('DIRECT, free tickets carry no fee at all', () => {
  const o = describeOrder({ ...base, faceCents: 0, chargeModel: CHARGE_MODEL.DIRECT });
  assert.equal(o.applicationFeeCents, 0);
  assert.equal(o.buyerTotalCents, 0);
  assert.equal(o.stripeCostCents, 0);
});
