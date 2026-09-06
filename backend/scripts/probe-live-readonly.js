/**
 * Is the LIVE platform account ready to take money through Connect?
 *
 *   node scripts/probe-live-readonly.js
 *
 * STRICTLY READ-ONLY. It creates nothing: no connected accounts, no charges, no
 * customers. Every call below is a GET. Going live is the operator's decision,
 * and a probe should not make it for them by leaving real objects behind.
 *
 * The live key is read from STRIPE_LIVE_SECRET_KEY, deliberately a DIFFERENT
 * variable from the one the API uses — so nothing can accidentally start
 * charging real cards because a probe set an environment variable.
 */
require('dotenv').config();
const Stripe = require('stripe');

const show = (label, value) => console.log(`  ${String(label).padEnd(26)} ${value}`);
const yes = (b) => (b ? 'YES' : 'no');

(async () => {
  const sk = process.env.STRIPE_LIVE_SECRET_KEY;
  if (!sk) {
    console.log('STRIPE_LIVE_SECRET_KEY is not set.');
    console.log('Add it to backend/.env to run this check. It is read-only.');
    process.exit(1);
  }
  if (!sk.startsWith('sk_live')) {
    console.log('That is not a live key. Nothing to check.');
    process.exit(1);
  }

  const stripe = Stripe(sk);
  const account = await stripe.accounts.retrieve();

  console.log('── live platform account ──');
  show('id', account.id);
  show('name', account.settings?.dashboard?.display_name || '(not set)');
  show('country', account.country);
  show('default_currency', account.default_currency);
  show('business_type', account.business_type || '(not set)');

  console.log('\n── is it activated? ──');
  // details_submitted is the one that decides whether Stripe will move real
  // money at all. Everything else is downstream of it.
  show('details_submitted', yes(account.details_submitted));
  show('charges_enabled', yes(account.charges_enabled));
  show('payouts_enabled', yes(account.payouts_enabled));

  const req = account.requirements || {};
  show('disabled_reason', req.disabled_reason || '(none)');
  show('currently_due', (req.currently_due || []).join(', ') || '(nothing)');
  show('past_due', (req.past_due || []).join(', ') || '(nothing)');
  show('pending_verification', (req.pending_verification || []).join(', ') || '(nothing)');

  console.log('\n── the capabilities Connect needs ──');
  const caps = account.capabilities || {};
  show('card_payments', caps.card_payments || '(not present)');
  show('transfers', caps.transfers || '(not present)');

  console.log('\n── is Connect on? ──');
  // Listing connected accounts is the cheapest read that fails distinctly when
  // Connect has never been enabled on the platform.
  try {
    const list = await stripe.accounts.list({ limit: 3 });
    show('accounts.list', `OK — ${list.data.length} connected account(s)`);
    for (const a of list.data) {
      show('  ', `${a.id}  charges=${yes(a.charges_enabled)} payouts=${yes(a.payouts_enabled)}`);
    }
  } catch (e) {
    show('accounts.list', `FAIL — ${String(e.message).slice(0, 120)}`);
  }

  console.log('\n── verdict ──');
  const ready = account.details_submitted && account.charges_enabled
    && account.payouts_enabled && caps.transfers === 'active';
  console.log(ready
    ? '  The live account looks ready. The remaining unknown is whether a\n'
      + '  destination charge is accepted — and the only way to know that is to\n'
      + '  make one, which this script deliberately does not do.'
    : '  NOT ready. Clear the items under "currently_due" in the Stripe Dashboard\n'
      + '  before any of this can take money.');
})().catch((e) => {
  console.log('probe failed:', e.message);
  process.exit(1);
});
