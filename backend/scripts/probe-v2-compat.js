/**
 * The decisive question: does a v2 connected account work with the CHARGE flow
 * this codebase already uses?
 *
 *   node scripts/probe-v2-compat.js
 *
 * Everything downstream of onboarding — checkout, fulfilment, the ledger —
 * assumes a v1 destination charge: `transfer_data.destination` plus
 * `application_fee_amount`. If a v2 account id is accepted there, migrating is
 * a change to one function. If it is not, it is a rewrite of the money path.
 *
 * Test mode only; refuses to run against a live key.
 */
require('dotenv').config();
const Stripe = require('stripe');

const PREVIEW = '2025-09-30.preview';
const short = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

(async () => {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk.startsWith('sk_test')) {
    console.log('refusing to run against a live key');
    process.exit(1);
  }

  const stripe = Stripe(sk);
  const preview = Stripe(sk, { apiVersion: PREVIEW });

  // A fresh v2 account to test against.
  const v2 = await preview.rawRequest('POST', '/v2/core/accounts', {
    display_name: 'Compat Probe',
    contact_email: 'compat@eventsli-test.invalid',
    identity: { country: 'CA', entity_type: 'individual' },
    dashboard: 'express',
    defaults: {
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      currency: 'cad',
    },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    include: ['configuration.merchant', 'configuration.recipient'],
  });
  console.log('v2 account:', v2.id);

  // ── Can the EXISTING v1 checkout flow target it? ──
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: { name: 'Compat probe ticket' },
          unit_amount: 10000,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        transfer_data: { destination: v2.id },
        application_fee_amount: 500,
        transfer_group: 'probe',
      },
      success_url: 'https://example.invalid/ok',
      cancel_url: 'https://example.invalid/no',
    });
    console.log('v1 checkout -> v2 account:  OK  ', session.id);
  } catch (e) {
    console.log('v1 checkout -> v2 account:  FAIL', short(e.message));
  }

  // ── Can we read it back with the v1 accounts API? ──
  // `organizerCanReceive` calls accounts.retrieve on every checkout.
  try {
    const a = await stripe.accounts.retrieve(v2.id);
    console.log(`v1 accounts.retrieve:       OK   charges=${a.charges_enabled} payouts=${a.payouts_enabled}`);
  } catch (e) {
    console.log('v1 accounts.retrieve:       FAIL', short(e.message, 120));
  }

  // ── Is this about v2, or about the PLATFORM? ──
  // The same call against a v1 account. If it fails identically, the account
  // version is a red herring and the blocker is a platform-level setting.
  try {
    const v1 = await stripe.accounts.create({
      type: 'express', country: 'CA',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: { currency: 'cad', product_data: { name: 'v1 probe' }, unit_amount: 10000 },
          quantity: 1,
        }],
        payment_intent_data: {
          transfer_data: { destination: v1.id },
          application_fee_amount: 500,
        },
        success_url: 'https://example.invalid/ok',
        cancel_url: 'https://example.invalid/no',
      });
      console.log('v1 checkout -> v1 account:  OK  ', s.id);
    } catch (e) {
      console.log('v1 checkout -> v1 account:  FAIL', short(e.message));
    }

    // And without the application fee — does Connect work at all?
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: { currency: 'cad', product_data: { name: 'no-fee probe' }, unit_amount: 10000 },
          quantity: 1,
        }],
        payment_intent_data: { transfer_data: { destination: v1.id } },
        success_url: 'https://example.invalid/ok',
        cancel_url: 'https://example.invalid/no',
      });
      console.log('transfer_data only:         OK  ', s.id);
    } catch (e) {
      console.log('transfer_data only:         FAIL', short(e.message, 160));
    }
  } catch (e) {
    console.log('v1 account for comparison:  FAIL', short(e.message, 120));
  }

  // ── Onboarding link ──
  try {
    const link = await stripe.accountLinks.create({
      account: v2.id, type: 'account_onboarding',
      refresh_url: 'https://example.invalid/r', return_url: 'https://example.invalid/d',
    });
    console.log('v1 accountLinks.create:     OK  ', link.url.slice(0, 44) + '...');
  } catch (e) {
    console.log('v1 accountLinks.create:     FAIL', short(e.message, 120));
  }
})().catch((e) => { console.log('probe failed:', short(e.message)); process.exit(1); });
