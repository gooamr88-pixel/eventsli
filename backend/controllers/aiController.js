const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { aiConfig } = require('../services/ai/config');
const quota = require('../services/ai/quotaService');
const { generateEventDraft } = require('../services/ai/eventDraftService');
const { redact } = require('../services/ai/redact');
const categoryService = require('../services/categoryService');
const events = require('../services/eventService');
const { organizerReadiness } = require('../services/submissionService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Eventsli AI — the organizer-facing endpoints.
 *
 * READ-ONLY PROPOSALS (D-007). Nothing here writes an event. The Smart Event
 * Creator returns a draft the organizer edits in the browser and then saves
 * through the same `POST /events`, `PATCH`, `/tiers` and `/schedule` calls the
 * manual screens use, under the same validation, permissions and review. The
 * only thing this file writes is the usage row in `ai_generations`.
 *
 * REFUSED BEFORE ANY COST. Disabled, an admin, an organization not set up, a
 * country we do not sell in — every one of those is answered before a
 * generation is reserved, so none of them spends the daily allowance (D-010).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Admins pass every organizer guard; here that would spend somebody else's allowance (D-014). */
function adminRefusal(req, res) {
  if (!req.user.access.isAdmin) return null;
  return sendFail(res, {
    status: 403, error: 'AI_ORGANIZER_ONLY',
    message: 'AI drafts are used from an organizer account, so they never spend an organizer’s daily allowance on their behalf.',
  });
}

function quotaShape(row, cfg) {
  return {
    enabled: cfg.enabled,
    limit: cfg.limit,
    used: row ? Number(row.used) : 0,
    remaining: row ? Number(row.remaining) : 0,
    nextAvailableAt: row?.next_available_at || null,
  };
}

// ─── GET /ai/quota ──────────────────────────────────────────────────────────
/**
 * Disabled is an answer, not an error: the entry card simply does not show.
 *
 * `reason` says WHICH disabled, because "the card is not there" has five causes
 * that look identical from the browser. Codes, not configuration: an organizer
 * learns only that AI is not set up, never which key is missing.
 *
 *   NOT_CONFIGURED       AI_ENABLED off, or no provider key (details in the boot log)
 *   ADMIN_ACCOUNT        admins never spend an organizer's allowance (D-014)
 *   NO_ORGANIZER         the account has no organizer profile yet
 *   DATABASE_NOT_READY   the ai_generations migration is not applied
 */
async function getQuota(req, res, next) {
  try {
    const cfg = aiConfig();
    const organizerId = req.user.access.organizerId;
    const off = (reason) => sendOk(res, { ...quotaShape(null, cfg), enabled: false, reason });
    if (!cfg.enabled) return off('NOT_CONFIGURED');
    if (req.user.access.isAdmin) return off('ADMIN_ACCOUNT');
    if (!organizerId) return off('NO_ORGANIZER');

    let row;
    try {
      row = await quota.status({ organizerId, cfg });
    } catch (err) {
      // Almost always "function ai_generation_status does not exist": the code
      // is deployed and the migration is not. Said loudly in the log, once per
      // request, and answered as "off" so the page still works without AI.
      logger.error({ err: err.message }, 'AI quota lookup failed — is migration 20261018090000_ai_generations.sql applied?');
      return off('DATABASE_NOT_READY');
    }
    return sendOk(res, { ...quotaShape(row, cfg), reason: null });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /ai/event-drafts ──────────────────────────────────────────────────
async function createEventDraft(req, res, next) {
  const cfg = aiConfig();
  let reservation = null;

  try {
    if (!cfg.enabled) {
      return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'AI drafts are not available on Eventsli right now.' });
    }
    const refused = adminRefusal(req, res);
    if (refused) return refused;

    const organizerId = req.user.access.organizerId;
    const readiness = organizerId ? await organizerReadiness(organizerId) : { setupComplete: false };
    if (!readiness.setupComplete) {
      return sendFail(res, {
        status: 403, error: 'ORGANIZER_SETUP_REQUIRED',
        message: 'Set up your organization (its name, brand and description) before creating an event.',
      });
    }

    const country = String(req.body.country).toUpperCase();
    const currency = await events.currencyForCountry(country);   // VALIDATION_ERROR for a market we do not serve
    const categories = await categoryService.list({ enabledOnly: true });
    const { text, removed } = redact(String(req.body.description).trim());

    reservation = await quota.reserve({
      organizerId,
      userId: req.user.id,
      feature: 'event_creator',
      requestId: req.body.requestId,
      cfg,
    });
    if (!reservation?.ok) {
      const r = reservation || {};
      reservation = null;   // nothing of ours to release
      if (r.reason === 'LIMIT') {
        return sendFail(res, {
          status: 429, error: 'AI_QUOTA_EXHAUSTED',
          message: 'You have used both of today’s AI drafts.',
          meta: { nextAvailableAt: r.next_available_at || null, limit: cfg.limit },
        });
      }
      if (r.reason === 'IN_PROGRESS') {
        return sendFail(res, { status: 409, error: 'AI_GENERATION_IN_PROGRESS', message: 'This draft is still being written.' });
      }
      if (r.reason === 'DUPLICATE') {
        return sendFail(res, { status: 409, error: 'AI_GENERATION_DUPLICATE', message: 'That request was already answered.' });
      }
      if (r.reason === 'GLOBAL_CAP') {
        logger.warn('ai: the platform-wide daily cap was reached');
        return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'AI drafts are busy today. Try again tomorrow, or set the event up step by step.' });
      }
      throw new Error(`ai_reserve_generation refused: ${r.reason || 'no answer'}`);
    }

    let result;
    try {
      result = await generateEventDraft({
        text,
        listingType: req.body.listingType,
        country,
        currency,
        timezone: req.body.timezone,
        categories,
        cfg,
      });
    } catch (err) {
      await quota.finish(reservation.id, 'released', err.meta || { failure_code: err.code || 'AI_ERROR' });
      reservation = null;
      if (err.code === 'AI_UNAVAILABLE') {
        return sendFail(res, {
          status: 503, error: 'AI_UNAVAILABLE',
          message: 'Our AI services did not answer in time. This did not use any of your daily drafts.',
        });
      }
      throw err;
    }

    await quota.finish(reservation.id, 'succeeded', result.meta);
    const generationId = reservation.id;
    reservation = null;

    const after = await quota.status({ organizerId, cfg });
    return sendOk(res, {
      generationId,
      draft: { ...result.draft, currency, country, timezone: req.body.timezone },
      redacted: removed,
      quota: quotaShape(after, cfg),
    });
  } catch (err) {
    // Whatever went wrong after a reservation, it must not cost the organizer.
    if (reservation?.id) {
      await quota.finish(reservation.id, 'released', { failure_code: 'SERVER_ERROR' })
        .catch((e) => logger.error({ err: e.message }, 'ai: could not release a reservation'));
    }
    if (err.code === 'VALIDATION_ERROR') {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    }
    return next(err);
  }
}

module.exports = { getQuota, createEventDraft };
