const { supabase } = require('../config/supabase');
const { uniqueSlug } = require('../utils/slug');
const events = require('../services/eventService');
const terms = require('../services/termsService');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

const SELECT = `
  id, slug, title, description, venue_name, venue_address, country, timezone,
  starts_at, ends_at, status, listing_type, purchase_mode, category,
  cover_url, cover_path, currency,
  commission_pct, commission_tax_pct, payment_fee_mode, payment_fee_pct,
  payment_fee_fixed_cents, fee_bearer, event_tax_pct,
  max_tickets_per_order, allow_ticket_transfer,
  rejection_reason, reviewed_at, cancelled_at, cancelled_reason,
  suspended_at, suspended_reason, terms_accepted_id, created_at, updated_at
`;

// ─── POST /events ───────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    const country = String(req.body.country).toUpperCase();

    // Throws VALIDATION_ERROR for a country we do not sell into (BRD §07).
    const currency = await events.currencyForCountry(country);
    const financials = await events.defaultFinancials();

    const slug = await uniqueSlug(req.body.title, async (candidate) => {
      const { data } = await supabase.from('events').select('id').eq('slug', candidate).maybeSingle();
      return !!data;
    });

    const { data, error } = await supabase
      .from('events')
      .insert({
        organizer_id: organizerId,
        slug,
        title: String(req.body.title).trim(),
        description: req.body.description ? String(req.body.description) : null,
        venue_name: req.body.venueName || null,
        venue_address: req.body.venueAddress || null,
        country,
        timezone: req.body.timezone,
        starts_at: req.body.startsAt,
        ends_at: req.body.endsAt,
        currency,
        listing_type: req.body.listingType || 'ticketed',
        purchase_mode: req.body.purchaseMode || 'seat_only',
        category: req.body.category || 'other',
        fee_bearer: req.body.feeBearer || 'buyer',
        ...financials,
        status: 'draft',
      })
      .select(SELECT)
      .single();

    if (error) throw new Error(error.message);
    return sendOk(res, shape(data), { status: 201 });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    }
    return next(err);
  }
}

// ─── GET /events ────────────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'starts_at', 'title', 'status'],
      defaultSort: 'created_at',
    });

    let query = supabase
      .from('events')
      .select(SELECT, { count: 'exact' })
      .eq('organizer_id', req.user.access.organizerId);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (p.q) query = query.ilike('title', `%${p.q}%`);

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map(shape), { pagination: buildMeta(p, count) });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /events/:eventId ───────────────────────────────────────────────────
async function get(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('events').select(SELECT).eq('id', req.params.eventId).single();
    if (error) throw new Error(error.message);
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

// ─── PATCH /events/:eventId ─────────────────────────────────────────────────
async function update(req, res, next) {
  try {
    const isAdmin = !!req.user.access.isAdmin;
    const { allowed, denied } = events.partitionPatch(req.body, { isAdmin });

    // Named explicitly rather than silently dropped: an organizer who thinks
    // they set their commission to 0% and got a 200 back has been misled.
    if (denied.length > 0) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN',
        message: `You cannot change: ${denied.join(', ')}.`,
        meta: { deniedFields: denied },
      });
    }
    if (Object.keys(allowed).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    }

    const { data: current } = await supabase
      .from('events').select('status, country, currency').eq('id', req.params.eventId).single();

    // A cancelled event is a historical record, not a draft (BRD §17).
    if (['cancelled', 'completed'].includes(current.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `A ${current.status} event cannot be edited.`,
      });
    }

    // Changing the country implies changing the currency (BRD §07), which the
    // database refuses once anything has sold. Check here so the message is
    // readable rather than a raw constraint violation.
    if (allowed.country && allowed.country.toUpperCase() !== current.country) {
      const newCurrency = await events.currencyForCountry(allowed.country);
      if (newCurrency !== current.currency && await events.hasPaidOrders(req.params.eventId)) {
        return sendFail(res, {
          status: 409, error: 'CURRENCY_LOCKED_AFTER_SALE',
          message: 'Tickets have already sold in ' + current.currency +
                   ', so this event cannot move to a country that uses a different currency.',
        });
      }
      allowed.country = allowed.country.toUpperCase();
      allowed.currency = newCurrency;
    }

    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('events').update(allowed).eq('id', req.params.eventId).select(SELECT).single();
    if (error) throw new Error(error.message);

    return sendOk(res, shape(data));
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: err.message });
    }
    return next(err);
  }
}

// ─── POST /events/:eventId/submit ───────────────────────────────────────────
// BRD §16 — an organizer cannot publish; they submit for review.
async function submitForReview(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, status, listing_type, starts_at, ends_at')
      .eq('id', req.params.eventId).single();

    if (!events.canTransition(event.status, 'pending_review')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `An event that is ${event.status} cannot be submitted for review.`,
      });
    }

    // BRD §21 — the confirmation step. Accepting the terms is what turns the
    // financial settings from something displayed into something agreed.
    const { accepted, termsId, version } = await terms.hasAcceptedCurrent({
      userId: req.user.id, audience: 'organizer', eventId: event.id,
    });
    if (!accepted) {
      return sendFail(res, {
        status: 403, error: 'TERMS_NOT_ACCEPTED',
        message: 'Review and accept the organizer terms for this event before submitting it.',
        meta: { termsId, version },
      });
    }

    if (new Date(event.starts_at) <= new Date()) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: 'This event starts in the past. Update the date before submitting.',
      });
    }

    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'pending_review',
        rejection_reason: null,      // a resubmission clears the previous verdict
        terms_accepted_id: termsId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      .eq('status', event.status)    // optimistic lock against a concurrent change
      .select(SELECT)
      .single();

    if (error) throw new Error(error.message);
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /events/:eventId/accept-terms ─────────────────────────────────────
async function acceptTerms(req, res, next) {
  try {
    const current = await terms.currentVersion('organizer');
    await terms.accept({
      userId: req.user.id, termsId: current.id, eventId: req.params.eventId, req,
    });
    return sendOk(res, { accepted: true, version: current.version, termsId: current.id });
  } catch (err) {
    if (err.code === 'CONFLICT') {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: err.message });
    }
    return next(err);
  }
}

// ─── POST /events/:eventId/cancel ───────────────────────────────────────────
/**
 * BRD §17 (revised) — cancellation belongs to the ORGANIZER.
 *
 * Nothing is deleted. Sold tickets stay, the event stays, and the buyer can
 * still see what they bought and that it was called off. Deleting would destroy
 * the record of a transaction that really happened, and the buyer's only
 * evidence of it.
 */
async function cancel(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).single();

    if (!events.canTransition(event.status, 'cancelled')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `An event that is ${event.status} cannot be cancelled.`,
      });
    }

    // An admin may suspend, not cancel: the organizer owes their buyers the
    // conversation, and cancelling on their behalf hides who decided.
    if (!req.user.access.organizerId || req.user.access.organizerId !== req.event?.organizer_id) {
      if (req.user.access.isAdmin) {
        return sendFail(res, {
          status: 403, error: 'FORBIDDEN',
          message: 'Admins suspend events; only the organizer can cancel one.',
        });
      }
    }

    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_reason: req.body.reason ? String(req.body.reason).slice(0, 1000) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      .eq('status', event.status)
      .select(SELECT)
      .single();

    if (error) throw new Error(error.message);

    // Scanning stops immediately — a cancelled event must not admit anyone.
    await supabase.from('scanner_access').upsert({
      event_id: event.id,
      is_locked: true,
      locked_reason: 'event_cancelled',
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });

    logger.info({ eventId: event.id, by: req.user.id }, 'event cancelled by organizer');
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

function shape(e) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description,
    venue: { name: e.venue_name, address: e.venue_address },
    country: e.country,
    timezone: e.timezone,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    listingType: e.listing_type,
    purchaseMode: e.purchase_mode,
    category: e.category,
    // `coverPath` is the organizer's own view of their event, and they need it:
    // the confirm step sends back the path it was given, and a page reloaded
    // mid-flow has to know which object is already current. It is absent from
    // every public shape — outside the dashboard the URL is the whole story.
    cover: e.cover_url ? { url: e.cover_url, path: e.cover_path } : null,
    currency: e.currency,
    // The organizer must see every amount they will bear (BRD §04, §21).
    fees: {
      commissionPct: Number(e.commission_pct),
      commissionTaxPct: Number(e.commission_tax_pct),
      paymentFeeMode: e.payment_fee_mode,
      paymentFeePct: Number(e.payment_fee_pct),
      paymentFeeFixedCents: e.payment_fee_fixed_cents,
      feeBearer: e.fee_bearer,
      eventTaxPct: Number(e.event_tax_pct),
    },
    rules: {
      maxTicketsPerOrder: e.max_tickets_per_order,
      allowTicketTransfer: e.allow_ticket_transfer,
    },
    review: {
      rejectionReason: e.rejection_reason,
      reviewedAt: e.reviewed_at,
      termsAccepted: !!e.terms_accepted_id,
    },
    cancelledAt: e.cancelled_at,
    cancelledReason: e.cancelled_reason,
    suspendedAt: e.suspended_at,
    suspendedReason: e.suspended_reason,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

module.exports = { create, list, get, update, submitForReview, acceptTerms, cancel, shape };
