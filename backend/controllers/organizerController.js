const { supabase } = require('../config/supabase');
const rbac = require('../services/rbacService');
const terms = require('../services/termsService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { canReceivePayouts } = require('../utils/payouts');
const { paymentChoices } = require('../services/eventRules');
const logger = require('../utils/logger');

/**
 * BRD §15 — anyone can become an organizer. One account, one organizer profile,
 * many events. Teams are deliberately out of scope for v1.
 *
 * SETUP, BEFORE THE FIRST EVENT. Creating the profile IS the setup step: the
 * organization's name, the brand buyers see, a description, the country (which
 * decides the Stripe entity) and agreeing to the organizer policies. Setup is
 * "complete" when all of those exist — derived from the columns every time,
 * never a flag that can disagree with them. An organizer from before this step
 * existed is asked for what is missing before their next new event.
 */

const COLUMNS = `
  id, display_name, legal_name, description, country, stripe_account_id,
  stripe_onboarding_complete, stripe_payouts_enabled, is_banned,
  policies_accepted_at, created_at
`;

/**
 * Records the organizer agreement against its current version, with no event.
 * The per-event acceptance at submit (BRD §21) still happens; this is the one
 * the account agrees to before it exists.
 *
 * With no organizer terms published there is no version to record against —
 * `policies_accepted_at` is still the record, and submit will refuse later.
 */
async function recordPolicyAcceptance(req) {
  try {
    const current = await terms.currentVersion('organizer');
    await terms.accept({ userId: req.user.id, termsId: current.id, eventId: null, req });
  } catch (err) {
    if (err.code !== 'CONFLICT') throw err;
    logger.warn('organizer setup: no organizer terms are published to record against');
  }
}

// ─── POST /organizer ────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    if (req.user.access.isOrganizer) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'You already have an organizer profile.',
      });
    }

    await recordPolicyAcceptance(req);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('organizers')
      .insert({
        owner_user_id: req.user.id,
        display_name: String(req.body.displayName).trim(),
        legal_name: String(req.body.legalName).trim(),
        description: String(req.body.description).trim(),
        country: String(req.body.country).toUpperCase(),
        policies_accepted_at: now,
        updated_at: now,
      })
      .select(COLUMNS)
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

    return sendOk(res, shape(data, { manualMethods: 0 }), { status: 201 });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /organizer/me ──────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('organizers')
      .select(COLUMNS)
      .eq('owner_user_id', req.user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND',
        message: 'You do not have an organizer profile yet.',
      });
    }
    return sendOk(res, shape(data, { manualMethods: await activeManualMethods(data.id) }));
  } catch (err) {
    return next(err);
  }
}

// ─── GET /organizer/setup-defaults ──────────────────────────────────────────
/**
 * What the setup step can pre-fill: the organization name typed at sign-up. So
 * nobody is asked the same question twice in their first five minutes.
 */
async function setupDefaults(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('organization_name, full_name')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return sendOk(res, {
      organizationName: data?.organization_name || '',
      fullName: data?.full_name || '',
    });
  } catch (err) {
    return next(err);
  }
}

// ─── PATCH /organizer ───────────────────────────────────────────────────────
async function update(req, res, next) {
  try {
    const patch = {};
    if (req.body.displayName !== undefined) patch.display_name = String(req.body.displayName).trim();
    if (req.body.legalName !== undefined) patch.legal_name = String(req.body.legalName).trim();
    if (req.body.description !== undefined) patch.description = String(req.body.description).trim();

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

    // An organizer from before the setup step finishes it here. Agreeing again
    // is harmless; an agreement is never withdrawn by sending `false`.
    if (req.body.acceptPolicies === true) {
      await recordPolicyAcceptance(req);
      patch.policies_accepted_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('organizers')
      .update(patch)
      .eq('owner_user_id', req.user.id)
      .select(COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    rbac.invalidate(req.user.id);
    return sendOk(res, shape(data, { manualMethods: await activeManualMethods(data.id) }));
  } catch (err) {
    return next(err);
  }
}

/** Is the organization set up enough to create an event? Pure. */
function isSetupComplete(row) {
  return Boolean(
    row?.display_name?.trim()
    && row?.legal_name?.trim()
    && row?.description?.trim()
    && row?.policies_accepted_at,
  );
}

async function activeManualMethods(organizerId) {
  const { count, error } = await supabase
    .from('organizer_payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('organizer_id', organizerId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return count || 0;
}

/**
 * `stripe_account_id` is never returned. It identifies a connected account and
 * is useful to an attacker; nothing in the UI needs it, only whether payouts
 * are possible.
 *
 * `payments.choices` is what an event of theirs can offer right now — the
 * create-event screen shows exactly these, so it never offers card payments to
 * an organizer who cannot be paid by card.
 */
function shape(row, { manualMethods = 0 } = {}) {
  const stripeReady = canReceivePayouts(row);
  const manualReady = manualMethods > 0;
  return {
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    description: row.description,
    country: row.country,
    stripeConnected: !!row.stripe_account_id,
    canReceivePayouts: stripeReady,
    isBanned: !!row.is_banned,
    policiesAcceptedAt: row.policies_accepted_at,
    setupComplete: isSetupComplete(row),
    payments: {
      stripeReady,
      stripeConnected: !!row.stripe_account_id,
      manualMethods,
      choices: paymentChoices({ stripeReady, manualReady }),
    },
    createdAt: row.created_at,
  };
}

// ═══ MANUAL PAYMENT METHODS ═════════════════════════════════════════════════
/**
 * Ways to take money outside Stripe — an e-Transfer address, bank details, cash.
 * Each is the organizer's own; every query is scoped by their organizer id, and
 * a method id belonging to someone else is simply not found.
 */

function shapeMethod(m) {
  return {
    id: m.id,
    kind: m.kind,
    label: m.label,
    instructions: m.instructions,
    isActive: m.is_active,
    createdAt: m.created_at,
  };
}

// ─── GET /organizer/payment-methods ─────────────────────────────────────────
async function listPaymentMethods(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('organizer_payment_methods')
      .select('id, kind, label, instructions, is_active, created_at')
      .eq('organizer_id', req.user.access.organizerId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map(shapeMethod));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /organizer/payment-methods ────────────────────────────────────────
async function createPaymentMethod(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    // A bound, not a business rule: a list this long is a mistake or a script.
    const { count } = await supabase
      .from('organizer_payment_methods')
      .select('id', { count: 'exact', head: true })
      .eq('organizer_id', organizerId);
    if ((count || 0) >= 10) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'You can keep up to 10 manual payment methods. Remove one you no longer use.',
      });
    }

    const { data, error } = await supabase
      .from('organizer_payment_methods')
      .insert({
        organizer_id: organizerId,
        kind: req.body.kind,
        label: String(req.body.label).trim(),
        instructions: String(req.body.instructions).trim(),
      })
      .select('id, kind, label, instructions, is_active, created_at')
      .single();
    if (error) throw new Error(error.message);
    return sendOk(res, shapeMethod(data), { status: 201 });
  } catch (err) {
    return next(err);
  }
}

// ─── PATCH /organizer/payment-methods/:methodId ─────────────────────────────
async function updatePaymentMethod(req, res, next) {
  try {
    const patch = {};
    if (req.body.kind !== undefined) patch.kind = req.body.kind;
    if (req.body.label !== undefined) patch.label = String(req.body.label).trim();
    if (req.body.instructions !== undefined) patch.instructions = String(req.body.instructions).trim();
    if (req.body.isActive !== undefined) patch.is_active = req.body.isActive === true;
    if (Object.keys(patch).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('organizer_payment_methods')
      .update(patch)
      .eq('id', req.params.methodId)
      .eq('organizer_id', req.user.access.organizerId)
      .select('id, kind, label, instructions, is_active, created_at')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such payment method.' });
    }
    return sendOk(res, shapeMethod(data));
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /organizer/payment-methods/:methodId ────────────────────────────
/**
 * Removing a method does not touch any event. An event that takes manual
 * payments and has no method left behind it is caught where it matters — at
 * submit, and on the event's checklist — rather than by refusing the delete.
 */
async function deletePaymentMethod(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('organizer_payment_methods')
      .delete()
      .eq('id', req.params.methodId)
      .eq('organizer_id', req.user.access.organizerId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such payment method.' });
    }
    return sendOk(res, { deleted: data.id });
  } catch (err) {
    return next(err);
  }
}

// ═══ STRIPE CONNECT ═════════════════════════════════════════════════════════

const stripeSvc = require('../services/stripeService');

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
        status: 503, error: 'FEATURE_DISABLED',
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
    return sendOk(res,{ onboardingUrl: url });
  } catch (raw) {
    const err = stripeSvc.translateConnectError(raw);

    if (err.code === 'FEATURE_DISABLED') {
      return sendFail(res, { status: 503, error: err.code, message: err.message });
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
      return sendOk(res,{ connected: false, canReceivePayouts: false, paymentsDisabled: true });
    }

    const status = await stripeSvc.refreshAccountStatus(req.user.access.organizerId);
    rbac.invalidate(req.user.id);
    return sendOk(res,status);
  } catch (err) { return next(err); }
}

module.exports = {
  create, me, update, setupDefaults, startStripeOnboarding, stripeStatus,
  listPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  isSetupComplete, activeManualMethods,
};
