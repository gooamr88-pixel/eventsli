const { supabase } = require('../config/supabase');
const { uniqueSlug } = require('../utils/slug');
const events = require('../services/eventService');
const terms = require('../services/termsService');
const { termsAcceptedFor, TERMS_ACCEPTABLE_FROM } = require('../services/eventRules');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { safeSearch } = require('../utils/search');
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
        // Only when sent, so the column defaults still decide otherwise. Both
        // were settable by PATCH alone, and no organizer screen sends a PATCH.
        ...(req.body.maxTicketsPerOrder !== undefined
          ? { max_tickets_per_order: Number(req.body.maxTicketsPerOrder) } : {}),
        ...(req.body.allowTicketTransfer !== undefined
          ? { allow_ticket_transfer: req.body.allowTicketTransfer === true || req.body.allowTicketTransfer === 'true' } : {}),
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
    // Sanitised like every other search: this one went into `ilike` untouched.
    const safe = safeSearch(p.q);
    if (safe) query = query.ilike('title', `%${safe}%`);

    const [{ data, error, count }, currentTermsId] = await Promise.all([
      applyPagination(query, p),
      currentOrganizerTermsId(),
    ]);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((e) => shape(e, { currentTermsId })), { pagination: buildMeta(p, count) });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /events/:eventId ───────────────────────────────────────────────────
async function get(req, res, next) {
  try {
    const [{ data, error }, currentTermsId] = await Promise.all([
      supabase.from('events').select(SELECT).eq('id', req.params.eventId).single(),
      currentOrganizerTermsId(),
    ]);
    if (error) throw new Error(error.message);
    return sendOk(res, shape(data, { currentTermsId }));
  } catch (err) {
    return next(err);
  }
}

/**
 * The id of the organizer terms in force, or null. Null is not an error here:
 * with no terms published nothing can be submitted anyway, and `submit` says so.
 */
async function currentOrganizerTermsId() {
  try {
    return (await terms.currentVersion('organizer')).id;
  } catch {
    return null;
  }
}

// ─── PATCH /events/:eventId ─────────────────────────────────────────────────
const { writeAudit } = require('../services/auditService');

async function update(req, res, next) {
  try {
    const isAdmin = !!req.user.access.isAdmin;
    // `reason` is an admin's note for the audit trail, not an event field.
    const { reason, ...fields } = req.body || {};
    const { allowed, denied } = events.partitionPatch(fields, { isAdmin });

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

    // An admin's edit is audited with what each field was, so read those too.
    // The column names come from partitionPatch's allowlist, never the request.
    const auditColumns = isAdmin ? Object.keys(allowed) : [];
    const { data: current } = await supabase
      .from('events')
      .select([...new Set(['status', 'country', 'currency', ...auditColumns])].join(', '))
      .eq('id', req.params.eventId).single();

    // A cancelled event is a historical record, not a draft (BRD §17).
    if (['cancelled', 'completed'].includes(current.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `A ${current.status} event cannot be edited.`,
      });
    }

    // BRD §16 — the reviewer approves what they saw. See editConsequence.
    const columns = Object.keys(allowed);
    const touchesSaleLocked = !isAdmin && columns.some((c) => events.LOCKED_AFTER_SALE.includes(c));
    const consequence = events.editConsequence({
      status: current.status,
      columns,
      isAdmin,
      hasPaidOrders: touchesSaleLocked ? await events.hasPaidOrders(req.params.eventId) : false,
    });
    if (consequence.refused.length > 0) {
      const fields = consequence.refused.map(events.apiFieldName);
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: consequence.reason === 'LOCKED_AFTER_SALE'
          ? `Tickets have already sold, so ${fields.join(', ')} can no longer change.`
          : `This event is on sale, so ${fields.join(', ')} cannot change without Eventsli `
            + 'reviewing it again. Contact us to make this change.',
        meta: { lockedFields: fields, reason: consequence.reason },
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

    // An edit to an event under review withdraws it: it goes back to draft and
    // is submitted again, so the reviewer never approves content they did not see.
    if (consequence.returnsToDraft) allowed.status = 'draft';
    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('events').update(allowed)
      .eq('id', req.params.eventId)
      // Optimistic lock. Without it an edit racing an approval could put a
      // just-published event back to draft, or edit it past the rules above.
      .eq('status', current.status)
      .select(SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'This event changed while you were editing it. Reload and try again.',
      });
    }

    // BRD §19 — an admin changing an organizer's event is on the record: what
    // each field was, what it became, and why. This endpoint wrote nothing.
    if (isAdmin) {
      const changed = columns.filter((c) => c !== 'updated_at');
      await writeAudit(req, {
        action: 'event.edited', targetType: 'event', targetId: req.params.eventId,
        payload: {
          reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
          before: Object.fromEntries(changed.map((c) => [c, current[c] ?? null])),
          after: Object.fromEntries(changed.map((c) => [c, data[c] ?? null])),
        },
      });
    }

    const currentTermsId = await currentOrganizerTermsId();
    return sendOk(
      res,
      shape(data, { currentTermsId }),
      consequence.returnsToDraft ? { meta: { returnedToDraft: true } } : undefined,
    );
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
    return sendOk(res, shape(data, { currentTermsId: termsId }));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /events/:eventId/accept-terms ─────────────────────────────────────
// BRD §21. Records the acceptance AND stamps it on the event, in one request.
//
// It used to do only the first. The event's `terms_accepted_id` — the field
// the dashboard reads — was written by `submit` alone, so after accepting the
// page still showed the terms step and kept Submit disabled behind a flag only
// Submit could set. See `termsAcceptedFor` in eventRules.js.
//
// `updated_at` is deliberately left alone: accepting is not an edit, and the
// details form re-seeds from that timestamp.
async function acceptTerms(req, res, next) {
  try {
    const { data: event, error: readError } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).single();
    if (readError) throw new Error(readError.message);

    if (!TERMS_ACCEPTABLE_FROM.includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `This event is ${event.status.replace('_', ' ')}, so its terms were already agreed when it was submitted.`,
      });
    }

    const current = await terms.currentVersion('organizer');
    const acceptance = await terms.accept({
      userId: req.user.id, termsId: current.id, eventId: event.id, req,
    });

    const { data, error } = await supabase
      .from('events')
      .update({ terms_accepted_id: current.id })
      .eq('id', event.id)
      .eq('status', event.status)    // optimistic lock, as submit does
      .select(SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'This event changed while you were accepting the terms. Reload and try again.',
      });
    }

    return sendOk(res, {
      accepted: true,
      version: current.version,
      termsId: current.id,
      acceptedAt: acceptance.accepted_at,
      // The updated event, so the page can move on without a second request.
      event: shape(data, { currentTermsId: current.id }),
    });
  } catch (err) {
    if (err.code === 'CONFLICT') {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: err.message });
    }
    return next(err);
  }
}

// Cancellation is not here. BRD §17: the organizer cannot cancel an event —
// see `admin/approvalController.cancel`.

/**
 * `currentTermsId` is the organizer terms version in force. Without it a stamp
 * from any version reads as accepted — right for callers outside the terms flow
 * (the cover upload), and `submit` still checks the current version itself.
 */
function shape(e, { currentTermsId = null } = {}) {
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
      termsAccepted: termsAcceptedFor(e, currentTermsId),
    },
    cancelledAt: e.cancelled_at,
    cancelledReason: e.cancelled_reason,
    suspendedAt: e.suspended_at,
    suspendedReason: e.suspended_reason,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

module.exports = { create, list, get, update, submitForReview, acceptTerms, shape, SELECT };
