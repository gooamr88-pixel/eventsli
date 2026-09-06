/**
 * Proves the destination-charge path is ACCEPTED on the live account —
 * without charging anyone.
 *
 *   node scripts/verify-live-money-path.js
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It creates two things on the live account:
 *   1. one connected account, un-onboarded — a placeholder, holds no money,
 *      safe to delete afterwards and this script offers to;
 *   2. one Checkout Session — an unpaid intent to charge. Creating a session
 *      moves NO money. It expires by itself if nobody pays it.
 *
 * That is enough, because the thing we do not know is whether Stripe ACCEPTS
 * `transfer_data.destination` + `application_fee_amount` on this platform. The
 * session is rejected or created at the moment those parameters are read —
 * long before a card is involved. If it is created, the money path is open.
 *
 * The alternative — finding out from the first real buyer — costs a refund and
 * an apology instead of ninety seconds.
 */
require('dotenv').config();
const Stripe = require('stripe');

const show = (l, v) => console.log(`  ${String(l).padEnd(24)} ${v}`);

(async () => {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk?.startsWith('sk_live')) {
    console.log('STRIPE_SECRET_KEY is not a live key — nothing to verify.');
    process.exit(1);
  }

  const stripe = Stripe(sk);
  const platform = await stripe.accounts.retrieve();
  console.log('── platform ──');
  show('account', `${platform.id}  ${platform.settings?.dashboard?.display_name || ''}`);
  show('mode', 'LIVE');

  console.log('\n── 1. can we create a connected account? ──');
  let connected;
  try {
    connected = await stripe.accounts.create({
      type: 'express',
      country: platform.country,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: 'Eventsli path check', product_description: 'Configuration check' },
      metadata: { purpose: 'eventsli-path-check', safe_to_delete: 'true' },
    });
    show('accounts.create', `OK  ${connected.id}`);
  } catch (e) {
    show('accounts.create', `FAIL  ${String(e.message).slice(0, 170)}`);
    process.exit(1);
  }

  console.log('\n── 2. is a destination charge accepted? ──');
  // The whole question. No card, no payment — just whether Stripe will accept
  // the shape of the charge this platform is built on.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: platform.default_currency,
          product_data: { name: 'Configuration check — do not pay' },
          unit_amount: 10000,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        transfer_data: { destination: connected.id },
        application_fee_amount: 500,
        transfer_group: 'path-check',
      },
      success_url: 'https://eventsli.com/checkout/success',
      cancel_url: 'https://eventsli.com/',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    show('checkout session', `OK  ${session.id}`);
    show('', 'unpaid, expires in 30 minutes, no money moved');
    console.log('\n  THE MONEY PATH IS OPEN. Destination charges are accepted on this account.');
  } catch (e) {
    show('checkout session', `FAIL  ${String(e.message).slice(0, 220)}`);
    console.log('\n  THE MONEY PATH IS BLOCKED. No buyer could complete a purchase.');
    console.log('  Fix this before opening sales — it is not a code problem.');
  }

  console.log('\n── 3. cleaning up ──');
  try {
    await stripe.accounts.del(connected.id);
    show('connected account', 'deleted');
  } catch (e) {
    // An account that has begun onboarding cannot be deleted. Ours has not, so
    // this normally succeeds; if it does not, say which one to remove by hand.
    show('connected account', `left behind — delete ${connected.id} in the Dashboard`);
  }
  console.log('  the checkout session expires on its own and cannot be paid by mistake');
})().catch((e) => { console.log('verification failed:', e.message); process.exit(1); });
