/**
 * Answers one question before it becomes a launch-day surprise:
 * can this platform actually create connected accounts, and on which API?
 *
 *   node scripts/probe-connect.js
 *
 * Read-mostly. The one write it performs is creating a connected account in
 * TEST mode, which is the only way to know whether creation works — a
 * capability listing does not tell you.
 */
require('dotenv').config();
const Stripe = require('stripe');

const short = (s, n = 150) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

(async () => {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) { console.log('STRIPE_SECRET_KEY is not set'); process.exit(1); }
  console.log('key mode:', sk.startsWith('sk_test') ? 'TEST' : 'LIVE');

  const stripe = Stripe(sk);

  // ── 1. v1 creation ──
  try {
    const a = await stripe.accounts.create({
      type: 'express',
      country: 'CA',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    console.log(`v1 create      OK   ${a.id}  charges=${a.charges_enabled} payouts=${a.payouts_enabled}`);
  } catch (e) {
    console.log('v1 create      FAIL', short(e.message));
  }

  // ── 2. v2 creation, on a preview API version ──
  // The preview header is what the v1 refusal points at. Worth knowing whether
  // it works at all before betting the migration on it.
  const version = '2025-09-30.preview';
  const shapes = [
    { label: 'merchant + recipient, express dashboard', body: {
      display_name: 'Probe Co',
      identity: { country: 'CA', entity_type: 'individual' },
      dashboard: 'express',
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      include: ['configuration.merchant', 'configuration.recipient'],
    } },
    { label: 'with responsibilities', body: {
      display_name: 'Probe Co',
      contact_email: 'probe@eventsli-test.invalid',
      identity: { country: 'CA', entity_type: 'individual' },
      dashboard: 'express',
      // The v1 equivalent of a destination charge: the PLATFORM takes the fee
      // and carries the loss, which is what application_fee_amount implied.
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        currency: 'cad',
      },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
    } },
  ];

  for (const shape of shapes) {
    try {
      const s2 = Stripe(sk, { apiVersion: version });
      const a = await s2.rawRequest('POST', '/v2/core/accounts', shape.body);
      console.log(`v2 ${shape.label}  OK   ${a.id}`);
      break;
    } catch (e) {
      console.log(`v2 ${shape.label}  FAIL`, short(e.message, 160));
    }
  }

  // ── 3. Is Connect on at all? (read-only) ──
  try {
    const list = await stripe.accounts.list({ limit: 1 });
    console.log(`connect        OK   ${list.data.length} existing connected account(s)`);
  } catch (e) {
    console.log('connect        FAIL', short(e.message));
  }
})();
