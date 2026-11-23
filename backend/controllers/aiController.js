const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { aiConfig: baseConfig, configFor } = require('../services/ai/config');
const quota = require('../services/ai/quotaService');
const { generateEventDraft } = require('../services/ai/eventDraftService');
const { redact } = require('../services/ai/redact');
const { readPosterImage } = require('../services/ai/posterImage');
const { generateSeatingPlan } = require('../services/ai/seatingDesigner');
const { readSeatingMap } = require('../services/ai/seatingFromImage');
const { startJob, getJob } = require('../services/ai/backgroundJobs');
const { generateLaunchKit } = require('../services/ai/launchKit');
const { eventUrl } = require('../services/shareLinks');
const { supabase } = require('../config/supabase');
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

/**
 * The AI settings for THIS caller: a super admin's have no daily allowance and
 * no platform cap (services/ai/config.js `configFor`).
 */
const aiConfig = (req) => configFor(baseConfig(), req.user.access);

/**
 * Admins pass every organizer guard; here that would spend somebody else's
 * allowance (D-014). Super admins are the exception (owner, 2026-11-10): they
 * use AI without limits, always recorded against their OWN organization, so
 * even on another organizer's event they never spend that organizer's drafts.
 */
function adminRefusal(req, res) {
  if (!req.user.access.isAdmin || req.user.access.isSuperAdmin) return null;
  return sendFail(res, {
    status: 403, error: 'AI_ORGANIZER_ONLY',
    message: 'AI drafts are used from an organizer account, so they never spend an organizer’s daily allowance on their behalf.',
  });
}

function quotaShape(row, cfg) {
  if (cfg.unlimited) {
    // No count to show: `remaining` stays a number so a screen that has not
    // learnt `unlimited` still reads it as "not used up".
    return {
      enabled: cfg.enabled,
      poster: Boolean(cfg.enabled && cfg.poster),
      unlimited: true,
      limit: null,
      used: row ? Number(row.used) : 0,
      remaining: cfg.limit,
      nextAvailableAt: null,
    };
  }
  return {
    enabled: cfg.enabled,
    // Whether "Start from a poster" is offered. Same allowance as a typed
    // description: a poster is one draft, whichever provider reads it.
    poster: Boolean(cfg.enabled && cfg.poster),
    unlimited: false,
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
    const cfg = aiConfig(req);
    const organizerId = req.user.access.organizerId;
    const off = (reason) => sendOk(res, { ...quotaShape(null, cfg), enabled: false, reason });
    if (!cfg.enabled) return off('NOT_CONFIGURED');
    if (req.user.access.isAdmin && !req.user.access.isSuperAdmin) return off('ADMIN_ACCOUNT');
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

// ─── Spending one generation ───────────────────────────────────────────────
/**
 * ONE PLACE THAT RESERVES, RUNS AND EITHER COUNTS OR GIVES BACK — for every AI
 * feature. The Smart Event Creator, the Seating Designer and the launch kit
 * share the organizer's daily allowance (D-002), so they must share the rules
 * that spend it: reserved before the provider is called, counted only once an
 * answer is accepted, released on every failure (D-010). Two copies of this is
 * how one feature would start charging for a failure the other refunds.
 *
 * `work()` returns `{ body, meta }`; `body` is merged into the response beside
 * `generationId` and the fresh quota. An error from `work` whose code is in
 * `answers` becomes that status and sentence; any other error is released and
 * passed on.
 *
 * Returns nothing: it always sends the response itself.
 */
const UNAVAILABLE = {
  status: 503,
  message: 'Our AI services did not answer in time. This did not use any of your daily drafts.',
};

const BUSY_MESSAGE = 'Our AI providers are busy right now. Wait a few minutes and try again. This did not use any of your daily drafts.';
const BUSY_CODES = new Set(['AI_UPSTREAM', 'AI_OVERLOADED', 'AI_RATE_LIMITED']);
function allBusy(err) {
  const tried = Array.isArray(err.tried) ? err.tried : [];
  return tried.length > 0 && tried.every((t) => BUSY_CODES.has(t.code) && (t.code !== 'AI_UPSTREAM' || t.status !== 500));
}

function failureSummary(err) {
  const tried = Array.isArray(err.tried) ? err.tried : [];
  if (tried.length === 0) return err.meta?.failure_code || null;
  return tried.map((t) => `${t.provider}: ${t.code}${t.status ? ` ${t.status}` : ''}${t.detail ? ` (${t.detail})` : ''}`)
    .join(' · ').slice(0, 500);
}

/**
 * Reserves one generation from the daily allowance. Returns `{ reservation }`,
 * or `{ sent }` when it already answered the request with a refusal.
 */
async function reserve(req, res, { cfg, organizerId, feature }) {
  // Every generation is recorded against an organization. A super admin can
  // reach any event, but without an organization of their own there is
  // nowhere to record it (and it must never land on the event's organizer).
  if (!organizerId) {
    return { sent: sendFail(res, {
      status: 403, error: 'ORGANIZER_SETUP_REQUIRED',
      message: 'Set up your organization before using AI.',
    }) };
  }
  let reservation;
  try {
    reservation = await quota.reserve({
      organizerId, userId: req.user.id, feature, requestId: req.body.requestId, cfg,
    });
  } catch (err) {
    // A feature added after the ai_generations migration needs its name in the
    // table's CHECK. Code deployed before the migration is "not set up yet",
    // said once in the log and as "off" to the organizer — not a 500 (I-023).
    if (/ai_generations_feature|check constraint/i.test(err.message)) {
      logger.error({ feature }, `AI: database NOT ready for "${feature}" — apply the latest supabase migration`);
      return { sent: sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'This AI feature is not set up yet. Try again later.' }) };
    }
    throw err;
  }

  if (!reservation?.ok) {
    const r = reservation || {};
    if (r.reason === 'LIMIT') {
      return { sent: sendFail(res, {
        status: 429, error: 'AI_QUOTA_EXHAUSTED',
        message: 'You have used both of today’s AI drafts.',
        meta: { nextAvailableAt: r.next_available_at || null, limit: cfg.limit },
      }) };
    }
    if (r.reason === 'IN_PROGRESS') {
      return { sent: sendFail(res, { status: 409, error: 'AI_GENERATION_IN_PROGRESS', message: 'This is still being written.' }) };
    }
    if (r.reason === 'DUPLICATE') {
      return { sent: sendFail(res, { status: 409, error: 'AI_GENERATION_DUPLICATE', message: 'That request was already answered.' }) };
    }
    if (r.reason === 'GLOBAL_CAP') {
      logger.warn('ai: the platform-wide daily cap was reached');
      return { sent: sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'AI is busy today. Try again tomorrow.' }) };
    }
    throw new Error(`ai_reserve_generation refused: ${r.reason || 'no answer'}`);
  }

  return { reservation };
}

/**
 * Runs `work` against a reservation and settles it: succeeded and charged,
 * or released at no cost. Returns `{ ok: true, body }` or `{ ok: false,
 * status, error, message, meta }` for a known failure; throws anything else.
 */
async function settle({ reservation, cfg, organizerId, answers = {} }, work) {
  let outcome;
  try {
    outcome = await work();
  } catch (err) {
    // Whatever went wrong, it must not cost the organizer.
    await quota.finish(reservation.id, 'released', err.meta || { failure_code: err.code || 'SERVER_ERROR' })
      .catch((e) => logger.error({ err: e.message }, 'ai: could not release a reservation'));
    const known = { AI_UNAVAILABLE: UNAVAILABLE, ...answers }[err.code];
    // Why every provider failed, provider by provider: our code, the HTTP
    // status, and for a refused request the provider's one-line reason
    // ("gemini: AI_TIMEOUT · groq: AI_REQUEST_REJECTED 400 (max tokens …)").
    // The message reads "did not answer in time" for all of them, and without
    // this a rejected request could not be told from a slow one (2026-11-19).
    const reason = err.code === 'AI_UNAVAILABLE' ? failureSummary(err) : null;
    if (known) {
      // Every provider up but busy (503, 522, a rate limit): say so, rather
      // than "did not answer in time", which reads as our fault and as final.
      const message = err.code === 'AI_UNAVAILABLE' && allBusy(err) ? BUSY_MESSAGE : known.message;
      return { ok: false, status: known.status, error: err.code, message, ...(reason ? { meta: { reason } } : {}) };
    }
    throw err;
  }

  await quota.finish(reservation.id, 'succeeded', outcome.meta);
  const after = await quota.status({ organizerId, cfg });
  return { ok: true, body: { generationId: reservation.id, ...outcome.body, quota: quotaShape(after, cfg) } };
}

const sendOutcome = (res, o) => (o.ok
  ? sendOk(res, o.body)
  : sendFail(res, { status: o.status, error: o.error, message: o.message, meta: o.meta }));

async function spend(req, res, opts, work) {
  const { reservation, sent } = await reserve(req, res, opts);
  if (sent) return sent;
  return sendOutcome(res, await settle({ ...opts, reservation }, work));
}

/**
 * `spend`, without holding the request open (2026-11-19): answers 202 with a
 * job id at once and runs `work` in the background (backgroundJobs.js). The
 * browser polls `GET …/jobs/:jobId`. For the seating-map reader, which can
 * take Gemini more than the 60 s production nginx allows a request.
 */
async function spendInBackground(req, res, opts, work) {
  const { reservation, sent } = await reserve(req, res, opts);
  if (sent) return sent;
  const jobId = reservation.id;
  startJob(jobId, { organizerId: opts.organizerId, eventId: req.params.eventId }, async () => {
    try {
      return await settle({ ...opts, reservation }, work);
    } catch (err) {
      logger.error({ err, jobId }, 'ai: a background job failed');
      return { ok: false, status: 500, error: 'INTERNAL_ERROR', message: 'Something went wrong while reading the map. Try again.' };
    }
  });
  return sendOk(res, { jobId, status: 'running' }, { status: 202 });
}

/** The refusals every organizer AI request shares, before anything costs. Returns a sent response or null. */
function refuseEarly(req, res, cfg) {
  if (!cfg.enabled) {
    return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'AI drafts are not available on Eventsli right now.' });
  }
  return adminRefusal(req, res);
}

// ─── POST /ai/event-drafts  ·  POST /ai/event-drafts/from-image ─────────────
/**
 * A typed description and a poster differ in what is sent and what the
 * evidence is checked against (`generateEventDraft`), and in nothing else.
 *
 * The poster is read and checked (`readPosterImage`) BEFORE the reservation,
 * so a file that is not an image, or not a readable one, never costs a draft.
 */
async function runDraft(req, res, next, { fromImage }) {
  const cfg = aiConfig(req);
  try {
    const refused = refuseEarly(req, res, cfg);
    if (refused) return refused;
    if (fromImage && !cfg.poster) {
      return sendFail(res, {
        status: 503, error: 'AI_DISABLED',
        message: 'Drafting from a poster is not available right now. Describe the event instead.',
      });
    }
    const image = fromImage ? readPosterImage(req.body.image) : null;   // VALIDATION_ERROR → 400

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
    const { text, removed } = redact(String((fromImage ? req.body.notes : req.body.description) || '').trim());

    return await spend(req, res, {
      cfg, organizerId, feature: 'event_creator',
      answers: {
        AI_NOT_AN_EVENT: {
          status: 422,
          message: 'We couldn’t find event details in that image. Try a poster or flyer that shows the event’s '
            + 'name and date. This did not use any of your daily drafts.',
        },
      },
    }, async () => {
      const result = await generateEventDraft({
        text, image, listingType: req.body.listingType, comingSoon: req.body.comingSoon === true, country, currency, timezone: req.body.timezone, categories, cfg,
      });
      return {
        meta: result.meta,
        body: {
          draft: { ...result.draft, currency, country, timezone: req.body.timezone },
          source: fromImage ? 'poster' : 'text',
          // What the model read off the poster, shown beside it on the review
          // screen: the one input the server cannot check, so the organizer can.
          ...(fromImage ? { posterText: result.posterText } : {}),
          redacted: removed,
        },
      };
    });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    }
    return next(err);
  }
}

// ─── The event the request is about ────────────────────────────────────────
/** Ownership is settled by `verifyEventOwner` on the route; this reads what the AI needs. */
async function loadEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, title, description, status, listing_type, admission_type, starts_at, ends_at, timezone, '
      + 'venue_name, venue_address, city, currency, highlights, category, organizers ( display_name ), event_categories ( label )')
    .eq('id', eventId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const CLOSED = ['cancelled', 'completed', 'archived'];
const conflict = (res, message) => sendFail(res, { status: 409, error: 'CONFLICT', message });

// ─── POST /ai/events/:eventId/seating-plan ─────────────────────────────────
/**
 * The Seating Designer (D-001, D-005, D-015). Refused before any cost when the
 * map cannot take a new layout: not reserved seating, closed, or — the one
 * that matters — any seat already held or sold. A layout is a full replace of
 * the map, and a buyer's seat must never be redrawn out from under them; the
 * save would refuse it anyway, but only after the draft was spent.
 */
async function createSeatingPlan(req, res, next) {
  const cfg = aiConfig(req);
  try {
    const refused = refuseEarly(req, res, cfg);
    if (refused) return refused;
    const organizerId = req.user.access.organizerId;
    const event = await loadEvent(req.params.eventId);
    const guard = await seatingGuard(res, event);
    if (guard.refused) return guard.refused;
    const { map } = guard;
    const [{ data: tiers }, { data: cats }] = await Promise.all([
      supabase.from('ticket_tiers').select('name').eq('event_id', event.id),
      supabase.from('table_categories').select('name').eq('event_id', event.id),
    ]);
    const zones = Array.isArray(map?.layout_json?.zones) ? map.layout_json.zones : [];
    const { text } = redact(String(req.body.description || '').trim());

    return await spend(req, res, {
      cfg, organizerId, feature: 'seating_designer',
      answers: {
        AI_NOT_A_ROOM: {
          status: 422,
          message: 'That doesn’t describe a room or its seating. Try something like “200 guests at round tables of 10, '
            + 'VIP near the stage, a dance floor and a bar.” This did not use any of your daily drafts.',
        },
      },
    }, async () => {
      const result = await generateSeatingPlan({
        description: text,
        eventTitle: event.title,
        ticketTypes: (tiers || []).map((t) => t.name),
        tableCategories: (cats || []).map((c) => c.name),
        hasStage: zones.some((z) => z?.kind === 'stage'),
        cfg,
      });
      return { meta: result.meta, body: { plan: result.plan } };
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * What both Seating Designer requests refuse before anything costs: a map
 * for an event that has none, a closed event, and a layout that buyers
 * already hold or own seats in. Returns `{ refused }` (a sent response) or `{ map }`.
 */
async function seatingGuard(res, event) {
  if (event.listing_type === 'display_only' || event.admission_type === 'general') {
    return { refused: conflict(res, 'The Seating Designer is for reserved-seating events, where buyers choose a seat or a table.') };
  }
  if (CLOSED.includes(event.status)) return { refused: conflict(res, `A ${event.status} event's seating cannot change.`) };

  // `layout_json` — the column's real name. This read asked for `layout`,
  // so the designer never knew a stage was already drawn.
  const { data: map } = await supabase.from('venue_maps').select('id, layout_json').eq('event_id', event.id).maybeSingle();
  if (map) {
    const { count, error } = await supabase.from('seats').select('id', { count: 'exact', head: true })
      .eq('venue_map_id', map.id).neq('status', 'available');
    if (error) throw new Error(error.message);
    if (count > 0) {
      return { refused: conflict(res, `${count} seat${count === 1 ? ' is' : 's are'} already held or sold, so the layout can't be replaced. Edit the map by hand instead.`) };
    }
  }
  return { map };
}

// ─── POST /ai/events/:eventId/seating-plan/from-image ─────────────────────
/**
 * A seating map read from a picture (owner, 2026-11-19). The picture is
 * checked (`readPosterImage`) before the reservation, so a file that is not a
 * readable image never costs a draft; it counts as one Seating Designer use.
 */
async function createSeatingPlanFromImage(req, res, next) {
  const cfg = aiConfig(req);
  try {
    const refused = refuseEarly(req, res, cfg);
    if (refused) return refused;
    if (!cfg.poster) {
      return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'Reading pictures is not available right now. Describe the room instead.' });
    }
    const event = await loadEvent(req.params.eventId);
    const guard = await seatingGuard(res, event);
    if (guard.refused) return guard.refused;
    const image = readPosterImage(req.body.image, { noun: 'seating map' });   // VALIDATION_ERROR → 400
    const { text } = redact(String(req.body.notes || '').trim());

    // In the background (2026-11-19): a whole floor plan took Gemini past the
    // 60 s production nginx allows one request. The page polls the job.
    return await spendInBackground(req, res, {
      cfg, organizerId: req.user.access.organizerId, feature: 'seating_designer',
      answers: {
        AI_NOT_A_MAP: {
          status: 422,
          message: 'That picture doesn’t look like a seating map. Try a floor plan or seating chart with the tables drawn on it. This did not use any of your daily drafts.',
        },
      },
    }, async () => {
      const result = await readSeatingMap({ image, notes: text, cfg });
      return { meta: result.meta, body: { plan: result.plan } };
    });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    return next(err);
  }
}

// ─── GET /ai/events/:eventId/seating-plan/jobs/:jobId ──────────────────────
/**
 * A background map reading: still running (200 `{ status: 'running' }`),
 * done (the same body the request used to answer with, plus `status`), or
 * failed (the same error it used to answer with). Only the organization and
 * event that started it can see it; anything else is "not found", including
 * a job lost to a server restart.
 */
function getSeatingPlanJob(req, res) {
  const job = getJob(req.params.jobId, { organizerId: req.user.access.organizerId, eventId: req.params.eventId });
  if (!job) {
    return sendFail(res, {
      status: 404, error: 'NOT_FOUND',
      message: 'That map reading is no longer available. Upload the picture again. Unfinished readings never use a daily draft.',
    });
  }
  if (job.state === 'running') return sendOk(res, { status: 'running', seconds: Math.round((Date.now() - job.startedAt) / 1000) });
  const o = job.outcome;
  if (o.ok) return sendOk(res, { status: 'done', ...o.body });
  return sendFail(res, { status: o.status, error: o.error, message: o.message, meta: o.meta });
}

// ─── POST /ai/events/:eventId/launch-kit ───────────────────────────────────
function whenText(e) {
  const fmt = (iso, opts) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: e.timezone }).format(new Date(iso));
  const day = fmt(e.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const from = fmt(e.starts_at, { hour: 'numeric', minute: '2-digit' });
  const to = e.ends_at ? fmt(e.ends_at, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null;
  return `${day}, ${from}${to ? ` to ${to}` : ''}`;
}

function priceText(tiers, currency) {
  const money = (c) => (c === 0 ? 'free' : `${require('../utils/money').formatCompact(c, currency)} ${currency}`);
  return tiers.map((t) => `${t.name} ${money(Number(t.price_cents))}`).join('; ');
}

/**
 * The launch kit. Built from the SAVED event, so it says what the page says.
 * A listing that sells nothing still gets posts — they just say where to read
 * more rather than where to buy.
 */
async function createLaunchKit(req, res, next) {
  const cfg = aiConfig(req);
  try {
    const refused = refuseEarly(req, res, cfg);
    if (refused) return refused;
    const organizerId = req.user.access.organizerId;
    const event = await loadEvent(req.params.eventId);
    if (CLOSED.includes(event.status)) return conflict(res, `A ${event.status} event has nothing left to promote.`);
    if (!event.starts_at) return conflict(res, 'Add the event’s date before creating posts for it.');

    const { data: tiers } = await supabase.from('ticket_tiers').select('name, price_cents')
      .eq('event_id', event.id).eq('is_hidden', false).order('sort_order');
    const org = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers;
    const cat = Array.isArray(event.event_categories) ? event.event_categories[0] : event.event_categories;
    const facts = {
      title: event.title,
      when: whenText(event),
      where: [event.venue_name, event.venue_address, event.city].filter(Boolean)
        .filter((v, i, all) => all.findIndex((x) => x.toLowerCase().includes(v.toLowerCase())) === i).join(', '),
      prices: event.listing_type === 'display_only' ? '' : priceText(tiers || [], event.currency),
      highlights: Array.isArray(event.highlights) ? event.highlights : [],
      category: cat?.label || event.category,
      organizer: org?.display_name || '',
      description: redact(String(event.description || '').slice(0, 1500)).text,
    };
    const note = redact(String(req.body.note || '').trim()).text;

    return await spend(req, res, { cfg, organizerId, feature: 'launch_kit' }, async () => {
      const result = await generateLaunchKit({ facts, url: eventUrl(event.slug), tone: req.body.tone, note, cfg });
      return { meta: result.meta, body: { kit: result.kit } };
    });
  } catch (err) {
    return next(err);
  }
}

const createEventDraft = (req, res, next) => runDraft(req, res, next, { fromImage: false });
const createEventDraftFromImage = (req, res, next) => runDraft(req, res, next, { fromImage: true });

// ─── POST /admin/venue-maps/read-image · GET …/read-image/:jobId ────────────
/**
 * The venue map library's "from a seating-chart picture" (owner, 2026-11-24):
 * the same reader as the Venue Builder's import, for a super admin building
 * Eventsli's library. No event and no organization, so no daily allowance —
 * super admins have none (config.isUnlimited) — and the job belongs to the
 * admin who started it. Routed from routes/admin/venueMapRoutes.js, behind
 * the super-admin guard and its own limiter.
 */
const LIBRARY_JOB = 'venue-library';

async function readVenueMapImage(req, res, next) {
  const cfg = aiConfig(req);
  try {
    if (!cfg.enabled || !cfg.poster) {
      return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'Reading pictures is not available right now.' });
    }
    const image = readPosterImage(req.body.image, { noun: 'seating map' });   // VALIDATION_ERROR → 400
    const { text } = redact(String(req.body.notes || '').trim());
    const jobId = req.body.requestId;
    startJob(jobId, { organizerId: `admin:${req.user.id}`, eventId: LIBRARY_JOB }, async () => {
      try {
        const result = await readSeatingMap({ image, notes: text, cfg });
        return { ok: true, body: { plan: result.plan } };
      } catch (err) {
        if (err.code === 'AI_NOT_A_MAP') {
          return { ok: false, status: 422, error: err.code, message: 'That picture doesn’t look like a seating map. Try the venue’s seating chart with the seats or tables drawn on it.' };
        }
        if (err.code === 'AI_UNAVAILABLE') {
          const reason = failureSummary(err);
          return {
            ok: false, status: UNAVAILABLE.status, error: err.code,
            message: allBusy(err) ? 'Our AI providers are busy right now. Wait a few minutes and try again.' : 'Our AI services did not answer in time. Try again.',
            ...(reason ? { meta: { reason } } : {}),
          };
        }
        logger.error({ err, jobId }, 'ai: a venue library reading failed');
        return { ok: false, status: 500, error: 'INTERNAL_ERROR', message: 'Something went wrong while reading the map. Try again.' };
      }
    });
    return sendOk(res, { jobId, status: 'running' }, { status: 202 });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    return next(err);
  }
}

function getVenueMapImageJob(req, res) {
  const job = getJob(req.params.jobId, { organizerId: `admin:${req.user.id}`, eventId: LIBRARY_JOB });
  if (!job) {
    return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That map reading is no longer available. Upload the picture again.' });
  }
  if (job.state === 'running') return sendOk(res, { status: 'running', seconds: Math.round((Date.now() - job.startedAt) / 1000) });
  const o = job.outcome;
  if (o.ok) return sendOk(res, { status: 'done', ...o.body });
  return sendFail(res, { status: o.status, error: o.error, message: o.message, meta: o.meta });
}

module.exports = {
  getQuota, createEventDraft, createEventDraftFromImage, createSeatingPlan, createSeatingPlanFromImage, getSeatingPlanJob,
  createLaunchKit, readVenueMapImage, getVenueMapImageJob,
};
