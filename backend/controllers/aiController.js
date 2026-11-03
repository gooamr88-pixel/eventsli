const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { aiConfig } = require('../services/ai/config');
const quota = require('../services/ai/quotaService');
const { generateEventDraft } = require('../services/ai/eventDraftService');
const { redact } = require('../services/ai/redact');
const { readPosterImage } = require('../services/ai/posterImage');
const { generateSeatingPlan } = require('../services/ai/seatingDesigner');
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
    // Whether "Start from a poster" is offered. Same allowance as a typed
    // description: a poster is one draft, whichever provider reads it.
    poster: Boolean(cfg.enabled && cfg.poster),
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

async function spend(req, res, { cfg, organizerId, feature, answers = {} }, work) {
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
      return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'This AI feature is not set up yet. Try again later.' });
    }
    throw err;
  }

  if (!reservation?.ok) {
    const r = reservation || {};
    if (r.reason === 'LIMIT') {
      return sendFail(res, {
        status: 429, error: 'AI_QUOTA_EXHAUSTED',
        message: 'You have used both of today’s AI drafts.',
        meta: { nextAvailableAt: r.next_available_at || null, limit: cfg.limit },
      });
    }
    if (r.reason === 'IN_PROGRESS') {
      return sendFail(res, { status: 409, error: 'AI_GENERATION_IN_PROGRESS', message: 'This is still being written.' });
    }
    if (r.reason === 'DUPLICATE') {
      return sendFail(res, { status: 409, error: 'AI_GENERATION_DUPLICATE', message: 'That request was already answered.' });
    }
    if (r.reason === 'GLOBAL_CAP') {
      logger.warn('ai: the platform-wide daily cap was reached');
      return sendFail(res, { status: 503, error: 'AI_DISABLED', message: 'AI is busy today. Try again tomorrow.' });
    }
    throw new Error(`ai_reserve_generation refused: ${r.reason || 'no answer'}`);
  }

  let outcome;
  try {
    outcome = await work();
  } catch (err) {
    // Whatever went wrong, it must not cost the organizer.
    await quota.finish(reservation.id, 'released', err.meta || { failure_code: err.code || 'SERVER_ERROR' })
      .catch((e) => logger.error({ err: e.message }, 'ai: could not release a reservation'));
    const known = { AI_UNAVAILABLE: UNAVAILABLE, ...answers }[err.code];
    if (known) return sendFail(res, { status: known.status, error: err.code, message: known.message });
    throw err;
  }

  await quota.finish(reservation.id, 'succeeded', outcome.meta);
  const after = await quota.status({ organizerId, cfg });
  return sendOk(res, { generationId: reservation.id, ...outcome.body, quota: quotaShape(after, cfg) });
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
  const cfg = aiConfig();
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
        text, image, listingType: req.body.listingType, country, currency, timezone: req.body.timezone, categories, cfg,
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
  const cfg = aiConfig();
  try {
    const refused = refuseEarly(req, res, cfg);
    if (refused) return refused;
    const organizerId = req.user.access.organizerId;
    const event = await loadEvent(req.params.eventId);
    if (event.listing_type === 'display_only' || event.admission_type === 'general') {
      return conflict(res, 'The Seating Designer is for reserved-seating events, where buyers choose a seat or a table.');
    }
    if (CLOSED.includes(event.status)) return conflict(res, `A ${event.status} event's seating cannot change.`);

    const { data: map } = await supabase.from('venue_maps').select('id, layout').eq('event_id', event.id).maybeSingle();
    if (map) {
      const { count, error } = await supabase.from('seats').select('id', { count: 'exact', head: true })
        .eq('venue_map_id', map.id).neq('status', 'available');
      if (error) throw new Error(error.message);
      if (count > 0) {
        return conflict(res, `${count} seat${count === 1 ? ' is' : 's are'} already held or sold, so the layout can't be replaced. Edit the map by hand instead.`);
      }
    }
    const [{ data: tiers }, { data: cats }] = await Promise.all([
      supabase.from('ticket_tiers').select('name').eq('event_id', event.id),
      supabase.from('table_categories').select('name').eq('event_id', event.id),
    ]);
    const zones = Array.isArray(map?.layout?.zones) ? map.layout.zones : [];
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

// ─── POST /ai/events/:eventId/launch-kit ───────────────────────────────────
function whenText(e) {
  const fmt = (iso, opts) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: e.timezone }).format(new Date(iso));
  const day = fmt(e.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const from = fmt(e.starts_at, { hour: 'numeric', minute: '2-digit' });
  const to = e.ends_at ? fmt(e.ends_at, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null;
  return `${day}, ${from}${to ? ` to ${to}` : ''}`;
}

function priceText(tiers, currency) {
  const money = (c) => (c === 0 ? 'free' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)} ${currency}`);
  return tiers.map((t) => `${t.name} ${money(Number(t.price_cents))}`).join('; ');
}

/**
 * The launch kit. Built from the SAVED event, so it says what the page says.
 * A listing that sells nothing still gets posts — they just say where to read
 * more rather than where to buy.
 */
async function createLaunchKit(req, res, next) {
  const cfg = aiConfig();
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

module.exports = { getQuota, createEventDraft, createEventDraftFromImage, createSeatingPlan, createLaunchKit };
