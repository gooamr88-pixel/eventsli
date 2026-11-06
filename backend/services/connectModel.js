/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What an organizer's Stripe account must BE before it may take a payment.
 * Pure — no Stripe client, no database — so it is testable with no credentials.
 *
 * Eventsli is event-management software. The organizer is the merchant of
 * record for their own ticket sales (TECH-AUDIT-LOG T-074). In Stripe terms:
 *
 *   dashboard / stripe_dashboard.type   full      the organizer has their own
 *                                                 Stripe account and Dashboard,
 *                                                 where they refund and respond
 *                                                 to disputes themselves
 *   fees_collector / fees.payer         stripe /  Stripe bills its processing
 *                                       account   fees to the ORGANIZER
 *   losses_collector / losses.payments  stripe    Stripe — not Eventsli — is
 *                                                 liable for a negative balance
 *                                                 the organizer cannot repay
 *   requirements_collector              stripe    Stripe runs onboarding and KYC
 *
 * Verified on the Canadian platform in test mode, 2026-11-06: Accounts v2
 * creates CA and US accounts with exactly these responsibilities under API
 * version 2026-10-28.endive, and the v1 view reports the same `controller`.
 *
 * `checkAccount` is a GATE on every checkout. An account with any other
 * configuration — a legacy Express account from the destination-charge model,
 * where the PLATFORM carried losses and paid Stripe — is refused, so Eventsli
 * cannot become liable for an organizer's losses by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Stripe API version for the Accounts v2 calls. Overridable, never preview. */
const ACCOUNTS_V2_API_VERSION = '2026-10-28.endive';

/** The v2 body that creates an organizer account with the required responsibilities. */
function accountCreateBody(organizer) {
  const country = String(organizer.country || '').toLowerCase();
  if (!['ca', 'us'].includes(country)) {
    throw Object.assign(new Error(`Organizers can connect from Canada or the United States, not "${organizer.country}".`),
      { code: 'VALIDATION_ERROR' });
  }
  return {
    display_name: organizer.display_name || undefined,
    contact_email: organizer.email || undefined,
    identity: { country },
    dashboard: 'full',
    defaults: {
      responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
    },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    metadata: { organizer_id: organizer.id },
    include: ['configuration.merchant', 'defaults', 'identity'],
  };
}

/**
 * Is this (v1-shaped) account one Eventsli may charge on?
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
function checkAccount(account) {
  if (!account || typeof account !== 'object') return { ok: false, reason: 'STRIPE_NOT_CONNECTED' };
  const c = account.controller || {};
  const wrong = [];
  if (c.losses?.payments !== 'stripe') wrong.push(`losses.payments=${c.losses?.payments ?? 'unset'} (must be stripe)`);
  if (c.fees?.payer !== 'account') wrong.push(`fees.payer=${c.fees?.payer ?? 'unset'} (must be account)`);
  if (c.stripe_dashboard?.type !== 'full') wrong.push(`stripe_dashboard.type=${c.stripe_dashboard?.type ?? 'unset'} (must be full)`);
  if (c.requirement_collection && c.requirement_collection !== 'stripe') {
    wrong.push(`requirement_collection=${c.requirement_collection} (must be stripe)`);
  }
  if (wrong.length) {
    return { ok: false, reason: 'STRIPE_ACCOUNT_MODEL', detail: wrong.join('; ') };
  }
  if (!account.charges_enabled || !account.payouts_enabled) {
    return { ok: false, reason: 'STRIPE_NOT_ACTIVE' };
  }
  return { ok: true };
}

module.exports = { ACCOUNTS_V2_API_VERSION, accountCreateBody, checkAccount };
