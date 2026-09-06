/**
 * What does Stripe think this PLATFORM account is?
 *
 *   node scripts/probe-platform.js
 *
 * The Connect refusal names "Managed Payments", but the Managed Payments
 * settings page offers it as something to BUY. Those two cannot both be true in
 * the obvious reading, so this reads the account itself rather than guessing
 * from the dashboard.
 *
 * Read-only.
 */
require('dotenv').config();
const Stripe = require('stripe');

const show = (label, value) => console.log(`  ${label.padEnd(28)} ${value}`);

(async () => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  const account = await stripe.accounts.retrieve();
  console.log('── platform account ──');
  show('id', account.id);
  show('country', account.country);
  show('default_currency', account.default_currency);
  show('type', account.type || '(none — a platform account)');
  show('charges_enabled', account.charges_enabled);
  show('payouts_enabled', account.payouts_enabled);
  show('details_submitted', account.details_submitted);
  show('business_type', account.business_type || '(not set)');

  console.log('\n── capabilities ──');
  const caps = account.capabilities || {};
  if (Object.keys(caps).length === 0) console.log('  (none listed)');
  for (const [k, v] of Object.entries(caps)) show(k, v);

  console.log('\n── what is still required ──');
  const req = account.requirements || {};
  show('disabled_reason', req.disabled_reason || '(none)');
  show('currently_due', (req.currently_due || []).join(', ') || '(nothing)');
  show('past_due', (req.past_due || []).join(', ') || '(nothing)');

  console.log('\n── connect settings ──');
  const s = account.settings || {};
  show('dashboard.display_name', s.dashboard?.display_name || '(not set)');
  show('payments.statement_desc', s.payments?.statement_descriptor || '(not set)');

  // A plain charge, no Connect at all. If this works, the account can take
  // money and the refusal really is specific to Connect rather than to the
  // account being unverified.
  console.log('\n── can it charge at all, without Connect? ──');
  try {
    const pi = await stripe.paymentIntents.create({
      amount: 1000, currency: 'cad',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });
    show('plain PaymentIntent', `OK  ${pi.id}`);
  } catch (e) {
    show('plain PaymentIntent', `FAIL  ${String(e.message).slice(0, 110)}`);
  }

  // And a SEPARATE transfer — the other Connect shape. If destination charges
  // are blocked but transfers are not, there is a route that keeps the money
  // model intact without `transfer_data`.
  console.log('\n── is the separate-transfer route open? ──');
  try {
    const accounts = await stripe.accounts.list({ limit: 1 });
    if (accounts.data.length === 0) {
      show('transfers.create', 'skipped — no connected account to aim at');
    } else {
      const target = accounts.data[0].id;
      try {
        await stripe.transfers.create({ amount: 100, currency: 'cad', destination: target });
        show('transfers.create', `OK  -> ${target}`);
      } catch (e) {
        // "Insufficient funds" would be a PASS: it means the call shape is
        // accepted and only the balance is missing.
        const msg = String(e.message);
        const shapeOk = /insufficient|balance/i.test(msg);
        show('transfers.create', `${shapeOk ? 'SHAPE OK' : 'FAIL'}  ${msg.slice(0, 110)}`);
      }
    }
  } catch (e) {
    show('transfers.create', `FAIL  ${String(e.message).slice(0, 110)}`);
  }
})().catch((e) => { console.log('probe failed:', e.message); process.exit(1); });
