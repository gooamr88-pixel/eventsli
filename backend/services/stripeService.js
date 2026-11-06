const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
// Pure, so it lives in a file with no I/O and can be tested without credentials.
const { translateConnectError } = require('./stripeErrors');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe, in one place.
 *
 * ── DIRECT CHARGES: THE ORGANIZER IS THE MERCHANT (TECH-AUDIT-LOG T-074) ──
 *
 * Eventsli is event-management software, not the seller. Every card checkout
 * is a DIRECT charge created ON the organizer's own connected account
 * (`stripeAccount`): the organizer is the merchant of record, the money lands in
 * THEIR balance and is paid out on THEIR schedule, Stripe bills its processing
 * fee to THEM, and refunds and disputes are debited from THEM. Eventsli takes
 * only `application_fee_amount` — its commission and the tax on it — and never
 * holds, pools or forwards ticket revenue (BRD §08).
 *
 * Connected accounts are Accounts v2 with Stripe as the losses collector, so an
 * organizer's unrecoverable negative balance is Stripe's, not the platform's.
 * `connectModel.checkAccount` refuses to charge on any account configured
 * otherwise. This REPLACES destination charges, under which the charge sat on
 * the platform, the platform paid Stripe and every dispute, and the platform
 * carried connected-account losses.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const connectModel = require('./connectModel');

let stripeClient = null;

/**
 * Created lazily so the API boots with no Stripe keys — the manual-payment path
 * and the whole organizer dashboard work without them, and requiring a key to
 * start would make local work impossible for anyone not handling money.
 */
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('Card payments are not configured.'),
      { code: 'FEATURE_DISABLED' });
  }
  if (!stripeClient) {
    // eslint-disable-next-line global-require
    stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

const enabled = () => /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_STRIPE_ENABLED || ''));

/**
 * Can this organizer actually be paid?
 *
 * Checked against Stripe, not only against our own flag: the flag is a cache of
 * something Stripe owns, and a connected account can be restricted after
 * onboarding completed. Selling tickets for an organizer who cannot receive the
 * money produces a charge that has to be unwound by hand.
 */
async function organizerCanReceive(organizerId) {
  const { data: org } = await supabase
    .from('organizers')
    .select('id, stripe_account_id, stripe_onboarding_complete, stripe_payouts_enabled')
    .eq('id', organizerId)
    .maybeSingle();

  if (!org?.stripe_account_id) {
    return { ok: false, reason: 'STRIPE_NOT_CONNECTED' };
  }

  try {
    const account = await stripe().accounts.retrieve(org.stripe_account_id);
    // Enabled AND configured as the organizer's own merchant account, with
    // Stripe — never Eventsli — carrying its losses (connectModel).
    const verdict = connectModel.checkAccount(account);
    const live = verdict.ok;

    // Heal a stale flag rather than leaving the dashboard telling the organizer
    // they are set up when Stripe disagrees.
    if (live !== !!org.stripe_payouts_enabled) {
      await supabase.from('organizers')
        .update({ stripe_payouts_enabled: live, stripe_onboarding_complete: live })
        .eq('id', org.id);
    }
    if (!live) {
      if (verdict.reason === 'STRIPE_ACCOUNT_MODEL') {
        // A legacy account (e.g. an Express account from the destination-charge
        // model, where the platform carried losses). Refused, loudly: charging
        // on it would make Eventsli liable for this organizer's losses. The
        // buyer is told only that payments are unavailable.
        logger.error({ organizerId, detail: verdict.detail },
          'checkout refused: connected account is not configured as the organizer\'s own merchant account');
      }
      return { ok: false, reason: 'STRIPE_NOT_ACTIVE', detail: verdict.reason };
    }
    return { ok: true, accountId: org.stripe_account_id };
  } catch (err) {
    logger.error({ err: err.message, organizerId }, 'Stripe account check failed');
    return { ok: false, reason: 'STRIPE_NOT_ACTIVE' };
  }
}

/**
 * The checkout session.
 *
 * ONE line item for the whole order, priced at the total our own arithmetic
 * produced. Itemising it for Stripe would mean two systems computing the same
 * total from the same inputs, and the first rounding disagreement is a charge
 * that does not match the receipt the buyer was shown.
 */
async function createCheckoutSession({
  reservationId, quote, buyer, origin, accountId, expiresAt, idempotencyKey,
}) {
  // Both come from services/checkoutSessions.js, which lengthens the hold so it
  // outlives this session and derives the key from every varying parameter.
  // Neither has a default: a clock-derived expiry under a fixed key is exactly
  // the pair that made a second "Pay" a 500 (TECH-AUDIT-LOG T-010, T-011).
  if (!Number.isInteger(expiresAt) || !idempotencyKey) {
    throw new Error('createCheckoutSession needs expiresAt and idempotencyKey');
  }
  const b = quote.breakdown;

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: String(quote.event.currency).toLowerCase(),
        product_data: {
          name: quote.event.title,
          description: `${quote.admits} ${quote.admits === 1 ? 'admission' : 'admissions'}`,
        },
        unit_amount: b.buyerTotalCents,
      },
      quantity: 1,
    }],
    customer_email: buyer.email || undefined,
    payment_intent_data: {
      // DIRECT CHARGE (see the header): the charge is created on the
      // organizer's account by the `stripeAccount` option below, so there is no
      // `transfer_data` and no `on_behalf_of` — nothing is transferred, the
      // money is theirs from the start. Eventsli's slice is this fee alone:
      // commission + its tax (utils/money.js describeDirectOrder).
      application_fee_amount: b.applicationFeeCents || undefined,
      metadata: { reservation_id: reservationId, event_id: quote.event.id },
    },
    // The reservation id is the key fulfilment is idempotent on. It has to
    // survive the round trip, so it goes in the session metadata as well.
    metadata: {
      reservation_id: reservationId,
      event_id: quote.event.id,
      buyer_name: buyer.name || '',
      buyer_phone: buyer.phone || '',
    },
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/e/${quote.event.slug}`,
    // Five minutes inside the hold, which was lengthened to cover it. A session
    // outliving its hold means paying for a released seat.
    expires_at: expiresAt,
    // ── NOT Managed Payments (TECH-AUDIT-LOG T-070, owner-approved 2026-11-06) ──
    // Stripe's merchant-of-record mode was on by default on the platform, and
    // with it on Stripe refuses any session whose product has no tax code —
    // every checkout here. It cannot apply to Eventsli in any case: Stripe
    // documents it as "direct integrations only" (no Connect platforms) and
    // lists live in-person events as ineligible. The ORGANIZER is the merchant
    // here and remits the event tax. Explicit per session so a Dashboard
    // default can never silently change who the merchant is. Accepted under
    // the pinned API version 2025-10-29.clover (checked in test mode).
    managed_payments: { enabled: false },
  }, {
    // On the ORGANIZER's account: this is what makes it a direct charge.
    stripeAccount: accountId,
    // The same parameters → the same session, so a double-clicked "Pay" does
    // not open a second one; different parameters → a different key, so a
    // retry is never refused for disagreeing with an earlier request.
    idempotencyKey,
  });

  return session;
}

/**
 * Verifies the webhook signature over the RAW body.
 *
 * Two endpoints, two secrets. Direct charges happen ON connected accounts, so
 * their events (checkout, refunds, disputes) arrive at the CONNECT endpoint
 * (`STRIPE_CONNECT_WEBHOOK_SECRET`) and carry `event.account`; the platform's
 * own events (`application_fee.*`) arrive at the account endpoint
 * (`STRIPE_WEBHOOK_SECRET`). Both may point at this one URL. A signature valid
 * under neither is refused.
 */
function constructEvent(rawBody, signature) {
  const secrets = [process.env.STRIPE_CONNECT_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET]
    .filter(Boolean);
  if (secrets.length === 0) throw new Error('No webhook signing secret is configured.');
  let last;
  for (const secret of secrets) {
    try {
      return stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/**
 * A Checkout Session lives on the account it was created on. Direct-charge
 * sessions are on the ORGANIZER's account, so `accountId` is required to find
 * them; it is omitted only for a legacy destination-charge session, which
 * lives on the platform.
 */
async function retrieveSession(sessionId, accountId) {
  return stripe().checkout.sessions.retrieve(sessionId, {}, accountId ? { stripeAccount: accountId } : undefined);
}

// ═══ CONNECT ONBOARDING ═════════════════════════════════════════════════════
/**
 * Without this an organizer has no way to accept card payments, and
 * `organizerCanReceive` refuses every checkout for them.
 *
 * ── THE ORGANIZER'S OWN STRIPE ACCOUNT (TECH-AUDIT-LOG T-074) ──
 *
 * Accounts v2, `dashboard: full`, Stripe as both fees collector and LOSSES
 * collector, Stripe-hosted onboarding (connectModel.accountCreateBody). The
 * organizer gets a full Stripe account and Dashboard of their own: they are the
 * merchant, they pay Stripe, they refund and answer disputes there, and Stripe
 * — not Eventsli — carries an unrecoverable negative balance.
 *
 * Why v2: this platform refuses v1 account creation outright ("Stripe no longer
 * recommends Accounts v1 for new Connect integrations"), and v1 Express — the
 * old choice — paired with destination charges put the platform on the hook for
 * losses. v2 account creation is GA under `2026-10-28.endive` (verified in test
 * mode; under the SDK's pinned 2025-10-29.clover it is preview-only), so that
 * version is sent for these calls alone. stripe-node 19 has no v2 accounts
 * resource, hence `rawRequest`. Everything else — Checkout, account reads,
 * Account Links — stays on the pinned v1 version, which reads these accounts
 * correctly.
 *
 * An organizer still on a LEGACY account (v1 Express from the old model) gets a
 * new, correctly configured account: charging on the legacy one is refused by
 * `organizerCanReceive`, because it would make the platform liable. The old
 * account is left untouched in Stripe and named in the log.
 */
async function ensureConnectedAccount(organizer) {
  if (organizer.stripe_account_id) {
    const existing = await stripe().accounts.retrieve(organizer.stripe_account_id);
    const verdict = connectModel.checkAccount(existing);
    if (verdict.reason !== 'STRIPE_ACCOUNT_MODEL') return organizer.stripe_account_id;
    logger.warn({ organizerId: organizer.id, legacyAccount: organizer.stripe_account_id, detail: verdict.detail },
      'replacing a legacy connected account with an organizer-owned (merchant of record) one');
  }

  const created = await stripe().rawRequest('POST', '/v2/core/accounts',
    connectModel.accountCreateBody(organizer), {
      apiVersion: process.env.STRIPE_ACCOUNTS_V2_API_VERSION || connectModel.ACCOUNTS_V2_API_VERSION,
      // A double-clicked "Connect" must not create two accounts. Stripe has no
      // uniqueness on connected accounts, so a duplicate is permanent and has
      // to be closed by hand.
      idempotencyKey: `connect_v2_${organizer.id}`,
    });
  const account = typeof created === 'string' ? JSON.parse(created) : created;

  const { error } = await supabase.from('organizers')
    .update({ stripe_account_id: account.id, stripe_onboarding_complete: false, stripe_payouts_enabled: false })
    .eq('id', organizer.id);
  // Losing the id means the next click creates ANOTHER account once the
  // idempotency key has expired. Fail loudly rather than carry on.
  if (error) throw new Error(`could not record the connected account ${account.id}: ${error.message}`);

  return account.id;
}

/**
 * A one-time link into Stripe's hosted onboarding.
 *
 * Deliberately short-lived — Stripe expires these in minutes. `refresh_url` is
 * where Stripe sends someone whose link went stale, and it must mint a NEW one
 * rather than showing an error, or an organizer who paused to find their bank
 * details is stuck.
 */
async function createOnboardingLink({ accountId, origin }) {
  const link = await stripe().accountLinks.create({
    account: accountId,
    // The organizer's Payouts page. These pointed at /dashboard/settings/payments,
    // a route from the previous frontend that does not exist here, so every
    // organizer who finished onboarding — or whose link expired — got a 404.
    refresh_url: `${origin}/organizer/payments?stripe=refresh`,
    return_url: `${origin}/organizer/payments?stripe=return`,
    type: 'account_onboarding',
  });
  return link.url;
}

/**
 * Re-reads the truth from Stripe and writes it down.
 *
 * Our flags are a CACHE of something Stripe owns. Onboarding finishes
 * asynchronously — the organizer can land back on our page before Stripe has
 * finished verifying them — and an account can be restricted later without
 * telling us. So the return page calls this, and so does every checkout.
 */
async function refreshAccountStatus(organizerId) {
  const { data: org } = await supabase
    .from('organizers').select('id, stripe_account_id').eq('id', organizerId).maybeSingle();

  if (!org?.stripe_account_id) {
    return { connected: false, canReceivePayouts: false, requirements: [] };
  }

  const account = await stripe().accounts.retrieve(org.stripe_account_id);
  const verdict = connectModel.checkAccount(account);
  const live = verdict.ok;

  await supabase.from('organizers')
    .update({ stripe_onboarding_complete: live, stripe_payouts_enabled: live })
    .eq('id', organizerId);

  return {
    connected: true,
    canReceivePayouts: live,
    // A legacy account the organizer must reconnect (connect again creates a
    // correctly configured one) — distinct from "onboarding not finished".
    needsReconnect: verdict.reason === 'STRIPE_ACCOUNT_MODEL',
    // Surfaced so the dashboard can say WHAT is outstanding. "Not ready yet"
    // with no reason leaves the organizer with nothing to do but wait.
    requirements: account.requirements?.currently_due || [],
    pendingVerification: account.requirements?.pending_verification || [],
    disabledReason: account.requirements?.disabled_reason || null,
  };
}

/**
 * Makes an open Checkout Session unpayable. Used when an event stops selling
 * while a buyer is still on Stripe's page (services/openCheckouts.js). Throws
 * for a session that has already completed or expired — the caller logs it.
 */
async function expireSession(sessionId, accountId) {
  return stripe().checkout.sessions.expire(sessionId, {}, accountId ? { stripeAccount: accountId } : undefined);
}

/**
 * The Checkout Session that produced a PaymentIntent, on the organizer's account.
 * Used when a refund or dispute event arrives BEFORE the payment's own
 * `checkout.session.completed` — Stripe does not order events (seen in test
 * mode 2026-11-06: a dispute 1 s ahead of its payment).
 */
async function sessionForPaymentIntent(paymentIntentId, accountId) {
  const list = await stripe().checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    accountId ? { stripeAccount: accountId } : undefined,
  );
  return list.data[0] || null;
}

/** A charge on the organizer's account — to map a refund or fee event back to its order. */
async function retrieveCharge(chargeId, accountId) {
  return stripe().charges.retrieve(chargeId, {}, accountId ? { stripeAccount: accountId } : undefined);
}

module.exports = {
  enabled,
  expireSession,
  organizerCanReceive,
  createCheckoutSession,
  constructEvent,
  retrieveSession,
  retrieveCharge,
  sessionForPaymentIntent,
  ensureConnectedAccount,
  createOnboardingLink,
  refreshAccountStatus,
  translateConnectError,
};
