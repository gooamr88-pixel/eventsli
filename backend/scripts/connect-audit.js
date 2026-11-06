/**
 * Connect audit — READ-ONLY. Which organizers can take card payments under the
 * merchant-of-record model (TECH-AUDIT-LOG T-074), and which must reconnect.
 *
 *   node scripts/connect-audit.js
 *
 * For every organizer with a Stripe account id it reads the account from Stripe
 * and runs the SAME gate checkout runs (services/connectModel.checkAccount).
 * Nothing is written: not to the database, not to Stripe. It prints organizer
 * ids, masked account ids and verdicts — no names, emails or bank details.
 *
 * Run it on the server BEFORE switching to the new code to see who will need
 * to reconnect, and after, to confirm. Live keys make it read live accounts.
 */
require('dotenv').config();
const { supabase } = require('../config/supabase');
const { checkAccount } = require('../services/connectModel');

const mask = (id) => (id ? `${id.slice(0, 9)}…${id.slice(-4)}` : '-');

(async () => {
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  if (!key) { console.error('STRIPE_SECRET_KEY is not set.'); process.exit(2); }
  // eslint-disable-next-line global-require
  const stripe = require('stripe')(key);
  console.log(`Mode: ${key.startsWith('sk_live_') ? 'LIVE' : 'test'} (read-only)\n`);

  const { data: orgs, error } = await supabase
    .from('organizers').select('id, country, stripe_account_id').not('stripe_account_id', 'is', null);
  if (error) { console.error(`organizers lookup failed: ${error.message}`); process.exit(1); }

  const tally = { ok: 0, reconnect: 0, onboarding: 0, unreadable: 0 };
  for (const o of orgs || []) {
    let verdict;
    try {
      // eslint-disable-next-line no-await-in-loop
      const a = await stripe.accounts.retrieve(o.stripe_account_id);
      verdict = checkAccount(a);
      const c = a.controller || {};
      const tag = verdict.ok ? 'READY' : verdict.reason === 'STRIPE_ACCOUNT_MODEL' ? 'RECONNECT' : 'ONBOARDING';
      tally[verdict.ok ? 'ok' : verdict.reason === 'STRIPE_ACCOUNT_MODEL' ? 'reconnect' : 'onboarding'] += 1;
      console.log(`${tag.padEnd(10)} organizer ${o.id} (${o.country}) ${mask(o.stripe_account_id)}`
        + ` | losses=${c.losses?.payments ?? '-'} fees=${c.fees?.payer ?? '-'} dashboard=${c.stripe_dashboard?.type ?? '-'}`
        + ` | charges=${a.charges_enabled} payouts=${a.payouts_enabled}`);
    } catch (e) {
      tally.unreadable += 1;
      console.log(`UNREADABLE organizer ${o.id} ${mask(o.stripe_account_id)} | ${e.code || e.type || e.message}`);
    }
  }

  console.log(`\n${(orgs || []).length} organizer(s) with a Stripe account:`
    + ` ${tally.ok} ready · ${tally.reconnect} must RECONNECT · ${tally.onboarding} still onboarding · ${tally.unreadable} unreadable`);
  if (tally.reconnect) {
    console.log('RECONNECT = an account from the old setup, on which Eventsli would carry the organizer\'s losses.'
      + ' Card checkout refuses it; the organizer reconnects on the Payments page.');
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
