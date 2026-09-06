const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
// Pure, so it lives in a file with no I/O and can be tested without credentials.
const { translateConnectError } = require('./stripeErrors');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe, in one place.
 *
 * ── DESTINATION CHARGES, AND WHY ──
 *
 * BRD §08: "no holding of organizer funds after the event". The organizer is
 * paid on the payment provider's own schedule, and the platform never sits on
 * their money. That is what `transfer_data.destination` does — Stripe moves the
 * organizer's share at the moment of the charge and hands us
 * `application_fee_amount`.
 *
 * The consequence to keep in mind: STRIPE'S PROCESSING FEE IS BILLED TO THE
 * PLATFORM, not the connected account. So our real margin is
 * `application_fee_amount − what Stripe charged us`, and if the payment fee was
 * set too low that difference is negative. utils/money.js computes both and
 * flags it; nothing here silently absorbs it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let stripeClient = null;

/**
 * Created lazily so the API boots with no Stripe keys — the manual-payment path
 * and the whole organizer dashboard work without them, and requiring a key to
 * start would make local work impossible for anyone not handling money.
 */
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('Card payments are not configured.'),
      { code: 'PAYMENT_REQUIRED' });
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
    const live = !!(account.charges_enabled && account.payouts_enabled);

    // Heal a stale flag rather than leaving the dashboard telling the organizer
    // they are set up when Stripe disagrees.
    if (live !== !!org.stripe_payouts_enabled) {
      await supabase.from('organizers')
        .update({ stripe_payouts_enabled: live, stripe_onboarding_complete: live })
        .eq('id', org.id);
    }
    if (!live) return { ok: false, reason: 'STRIPE_NOT_ACTIVE' };
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
async function createCheckoutSession({ reservationId, quote, buyer, origin, accountId }) {
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
      // BRD §08 — the organizer's share moves now, not after the event.
      transfer_data: { destination: accountId },
      application_fee_amount: b.applicationFeeCents,
      // Ties every charge for this event together, so reconciliation and any
      // later reversal can find them without a join through our own tables.
      transfer_group: `event_${quote.event.id}`,
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
    // Comfortably inside the hold, which app.js refuses to boot below 31
    // minutes. A session outliving its hold means paying for a released seat.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  }, {
    // Derived from the reservation, so a double-clicked "Pay" or a retried
    // request returns the SAME session instead of opening a second one.
    idempotencyKey: `checkout_${reservationId}`,
  });

  return session;
}

/** Verifies the webhook signature over the RAW body. */
function constructEvent(rawBody, signature) {
  return stripe().webhooks.constructEvent(
    rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET,
  );
}

async function retrieveSession(sessionId) {
  return stripe().checkout.sessions.retrieve(sessionId);
}

// ═══ CONNECT ONBOARDING ═════════════════════════════════════════════════════
/**
 * Without this an organizer has no way to attach a payout destination, and
 * `organizerCanReceive` refuses every checkout for them — a complete event
 * that cannot take a single payment, with nothing in the product to fix it.
 *
 * EXPRESS accounts, not Standard or Custom. Stripe hosts the onboarding form
 * and owns the identity verification, the KYC and the ongoing compliance — none
 * of which we want to be responsible for storing, and Express is what makes
 * `application_fee_amount` on a destination charge work.
 */
/**
 * ── A NOTE ON ACCOUNTS v1 vs v2 ──
 *
 * Stripe now steers new integrations to Accounts v2 (`POST /v2/core/accounts`)
 * and refuses `accounts.create` with:
 *
 *   Stripe no longer recommends Accounts v1 for new Connect integrations.
 *
 * We stay on v1 deliberately, for now:
 *
 *   • v2 is still a PREVIEW API — it needs an explicit preview version header
 *     and can change without notice. A preview API is a bad place to put the
 *     path that moves other people's money.
 *   • The rest of this integration is v1 Connect throughout —
 *     `transfer_data.destination` and `application_fee_amount` on a destination
 *     charge. Mixing a v2 account into a v1 charge flow is not a smaller change
 *     than migrating both together, later, on purpose.
 *
 * v1 is one Dashboard toggle away and Stripe supports it explicitly for this
 * case. `translateConnectError` below turns the refusal into an instruction
 * rather than a stack trace, because the person who hits it is an operator, not
 * whoever wrote this.
 */
async function ensureConnectedAccount(organizer) {
  if (organizer.stripe_account_id) return organizer.stripe_account_id;

  const account = await stripe().accounts.create({
    type: 'express',
    // From the ORGANIZER row, not the request: it decides which Stripe entity
    // they are onboarded under and which currency they settle in, and it is
    // deliberately not editable through the profile endpoint.
    country: organizer.country,
    email: organizer.email || undefined,
    business_type: 'individual',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      name: organizer.display_name,
      product_description: 'Event tickets sold through Eventsli',
    },
    metadata: { organizer_id: organizer.id },
  }, {
    // A double-clicked "Connect" must not create two accounts. Stripe has no
    // uniqueness on connected accounts, so a duplicate is permanent and has to
    // be closed by hand.
    idempotencyKey: `connect_${organizer.id}`,
  });

  await supabase.from('organizers')
    .update({ stripe_account_id: account.id })
    .eq('id', organizer.id);

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
    refresh_url: `${origin}/dashboard/settings/payments?refresh=1`,
    return_url: `${origin}/dashboard/settings/payments?done=1`,
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
  const live = !!(account.charges_enabled && account.payouts_enabled);

  await supabase.from('organizers')
    .update({ stripe_onboarding_complete: live, stripe_payouts_enabled: live })
    .eq('id', organizerId);

  return {
    connected: true,
    canReceivePayouts: live,
    // Surfaced so the dashboard can say WHAT is outstanding. "Not ready yet"
    // with no reason leaves the organizer with nothing to do but wait.
    requirements: account.requirements?.currently_due || [],
    pendingVerification: account.requirements?.pending_verification || [],
    disabledReason: account.requirements?.disabled_reason || null,
  };
}

module.exports = {
  enabled,
  organizerCanReceive,
  createCheckoutSession,
  constructEvent,
  retrieveSession,
  ensureConnectedAccount,
  createOnboardingLink,
  refreshAccountStatus,
  translateConnectError,
};
