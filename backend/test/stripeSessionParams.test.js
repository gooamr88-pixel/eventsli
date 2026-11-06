const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The exact parameters `createCheckoutSession` sends to Stripe.
 *
 * The Stripe SDK is replaced before stripeService loads it, so this captures
 * the request instead of making one. Regressions for TECH-AUDIT-LOG T-070
 * (Managed Payments explicitly off) and T-010/T-011 (expiry and key come from
 * the caller, never from the clock).
 */
const root = path.join(__dirname, '..');
function stub(file, exports) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub(require.resolve(path.join(root, 'config/supabase.js')), { supabase: {} });

const captured = [];
stub(require.resolve('stripe', { paths: [root] }), () => ({
  checkout: {
    sessions: {
      create: async (params, options) => {
        captured.push({ params, options });
        return { id: 'cs_test_x', url: 'https://checkout.stripe.test/x' };
      },
    },
  },
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_unit_only';
const stripeSvc = require('../services/stripeService');

const args = () => ({
  reservationId: 'r1',
  quote: {
    event: { id: 'e1', slug: 'gala', title: 'Gala', currency: 'CAD' },
    admits: 2,
    breakdown: { buyerTotalCents: 11300, applicationFeeCents: 450 },
  },
  buyer: { name: 'Ada', email: 'ada@example.test', phone: '' },
  origin: 'https://eventsli.test',
  accountId: 'acct_test_org',
  expiresAt: 1_900_000_000,
  idempotencyKey: 'checkout_r1_abc',
});

test('REGRESSION T-070: every session is sent with Managed Payments explicitly off', async () => {
  captured.length = 0;
  await stripeSvc.createCheckoutSession(args());
  assert.deepEqual(captured[0].params.managed_payments, { enabled: false });
});

test('T-074: a DIRECT charge on the organizer\'s account — no transfer, Eventsli takes only its fee', async () => {
  captured.length = 0;
  await stripeSvc.createCheckoutSession(args());
  const { params, options } = captured[0];
  // Created ON the organizer's account: they are the merchant of record.
  assert.equal(options.stripeAccount, 'acct_test_org');
  const pi = params.payment_intent_data;
  // Nothing is transferred, and nothing is charged on the platform's behalf.
  assert.equal(pi.transfer_data, undefined, 'no destination transfer');
  assert.equal(pi.on_behalf_of, undefined, 'no on_behalf_of');
  assert.equal(pi.transfer_group, undefined);
  assert.equal(params.on_behalf_of, undefined);
  assert.equal(pi.application_fee_amount, 450, 'the platform fee alone');
  assert.equal(params.line_items[0].price_data.unit_amount, 11300);
  assert.equal(params.line_items[0].price_data.currency, 'cad');
});

test('the expiry and idempotency key are the caller\'s, never the clock\'s', async () => {
  captured.length = 0;
  await stripeSvc.createCheckoutSession(args());
  assert.equal(captured[0].params.expires_at, 1_900_000_000);
  assert.equal(captured[0].options.idempotencyKey, 'checkout_r1_abc');
});

test('a call without an expiry or a key is refused before Stripe is asked', async () => {
  captured.length = 0;
  await assert.rejects(stripeSvc.createCheckoutSession({ ...args(), expiresAt: undefined }), /needs expiresAt/);
  await assert.rejects(stripeSvc.createCheckoutSession({ ...args(), idempotencyKey: '' }), /needs expiresAt/);
  assert.equal(captured.length, 0);
});
