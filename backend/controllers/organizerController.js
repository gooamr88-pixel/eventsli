const { supabase } = require('../config/supabase');
const rbac = require('../services/rbacService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * BRD §15 — anyone can become an organizer. One account, one organizer profile,
 * many events. Teams are deliberately out of scope for v1.
 */

// ─── POST /organizer ────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    if (req.user.access.isOrganizer) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'You already have an organizer profile.',
      });
    }

    const { data, error } = await supabase
      .from('organizers')
      .insert({
        owner_user_id: req.user.id,
        display_name: String(req.body.displayName).trim(),
        country: String(req.body.country).toUpperCase(),
      })
      .select('id, display_name, country, stripe_onboarding_complete, stripe_payouts_enabled')
      .single();

    if (error) {
      if (error.code === '23505') {
        return sendFail(res, {
          status: 409, error: 'CONFLICT', message: 'You already have an organizer profile.',
        });
      }
      throw new Error(error.message);
    }

    // The role follows the profile. Left at 'attendee', requireRole('organizer')
    // would reject them from the dashboard they just created.
    await supabase.from('profiles')
      .update({ role: 'organizer' })
      .eq('id', req.user.id)
      .eq('role', 'attendee');   // never demote an admin who also organizes

    // The access context is cached for a few seconds; without this the very next
    // request still sees them as an attendee.
    rbac.invalidate(req.user.id);

    return sendOk(res, shape(data), { status: 201 });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /organizer/me ──────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('organizers')
      .select('id, display_name, country, stripe_account_id, stripe_onboarding_complete, stripe_payouts_enabled, is_banned, created_at')
      .eq('owner_user_id', req.user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND',
        message: 'You do not have an organizer profile yet.',
      });
    }
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

// ─── PATCH /organizer ───────────────────────────────────────────────────────
async function update(req, res, next) {
  try {
    const patch = {};
    if (req.body.displayName !== undefined) patch.display_name = String(req.body.displayName).trim();

    // `country` is NOT editable here. It determines which Stripe entity the
    // organizer is onboarded under and is used to resolve settlement currency —
    // changing it after events exist would silently reinterpret them. Moving
    // country is a support conversation, not a form field.
    if (req.body.country !== undefined) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: 'Country cannot be changed here — contact support.',
      });
    }

    if (Object.keys(patch).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    }

    const { data, error } = await supabase
      .from('organizers')
      .update(patch)
      .eq('owner_user_id', req.user.id)
      .select('id, display_name, country, stripe_account_id, stripe_onboarding_complete, stripe_payouts_enabled')
      .single();

    if (error) throw new Error(error.message);
    rbac.invalidate(req.user.id);
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

/**
 * `stripe_account_id` is never returned. It identifies a connected account and
 * is useful to an attacker; nothing in the UI needs it, only whether payouts
 * are possible.
 */
function shape(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    country: row.country,
    stripeConnected: !!row.stripe_account_id,
    canReceivePayouts: !!(row.stripe_onboarding_complete && row.stripe_payouts_enabled),
    isBanned: !!row.is_banned,
    createdAt: row.created_at,
  };
}

// ═══ STRIPE CONNECT ═════════════════════════════════════════════════════════

const stripeSvc = require('../services/stripeService');
const { sendOk: ok } = require('../utils/responseEnvelope');

/**
 * POST /organizer/stripe/onboard
 *
 * Creates the connected account if there isn't one, then returns a link into
 * Stripe's hosted onboarding. Safe to call repeatedly: the account creation is
 * idempotent on the organizer id, and a fresh link is exactly what someone
 * whose previous link expired needs.
 */
async function startStripeOnboarding(req, res, next) {
  try {
    if (!stripeSvc.enabled()) {
      return sendFail(res, {
        status: 402, error: 'PAYMENT_REQUIRED',
        message: 'Card payments are not enabled on this platform yet.',
      });
    }

    const { data: org } = await supabase
      .from('organizers')
      .select('id, display_name, country, stripe_account_id, profiles!organizers_owner_user_id_fkey ( email )')
      .eq('owner_user_id', req.user.id)
      .maybeSingle();

    if (!org) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND',
        message: 'Create your organizer profile first.',
      });
    }

    const accountId = await stripeSvc.ensureConnectedAccount({
      id: org.id,
      country: org.country,
      display_name: org.display_name,
      email: org.profiles?.email || req.user.email,
      stripe_account_id: org.stripe_account_id,
    });

    // The return target comes from OUR allowlist, never from the request —
    // `origin` is attacker-controlled, and echoing it turns this into an open
    // redirect wearing our domain.
    const allowed = String(process.env.FRONTEND_URL || '')
      .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
    const claimed = String(req.headers.origin || '').replace(/\/$/, '');
    const origin = allowed.includes(claimed) ? claimed : allowed[0] || 'http://localhost:3000';

    const url = await stripeSvc.createOnboardingLink({ accountId, origin });
    rbac.invalidate(req.user.id);
    return ok(res, { onboardingUrl: url });
  } catch (raw) {
    const err = stripeSvc.translateConnectError(raw);

    if (err.code === 'PAYMENT_REQUIRED') {
      return sendFail(res, { status: 402, error: err.code, message: err.message });
    }

    // A platform misconfiguration is not the organizer's fault and not
    // something they can fix. Logged at error level with the instruction in it,
    // and answered with a sentence that does not blame them.
    if (err.code === 'STRIPE_NOT_CONFIGURED') {
      logger.error({ action: err.message }, 'Stripe Connect is not configured on the platform account');
      return sendFail(res, {
        status: 503, error: 'STRIPE_NOT_CONFIGURED',
        message: 'Payment setup is temporarily unavailable. We have been notified.',
      });
    }
    return next(raw);
  }
}

/**
 * GET /organizer/stripe/status
 *
 * Re-reads the account from Stripe rather than answering from our own flags.
 * Onboarding completes asynchronously — an organizer can land back on the
 * dashboard before Stripe has finished verifying them — and an account can be
 * restricted later without telling us.
 */
async function stripeStatus(req, res, next) {
  try {
    if (!req.user.access.organizerId) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND', message: 'Create your organizer profile first.',
      });
    }
    if (!stripeSvc.enabled()) {
      return ok(res, { connected: false, canReceivePayouts: false, paymentsDisabled: true });
    }

    const status = await stripeSvc.refreshAccountStatus(req.user.access.organizerId);
    rbac.invalidate(req.user.id);
    return ok(res, status);
  } catch (err) { return next(err); }
}

module.exports = { create, me, update, startStripeOnboarding, stripeStatus };
