const { supabase } = require('../../config/supabase');
const events = require('../../services/eventService');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail, ERROR_STATUS } = require('../../utils/responseEnvelope');
const logger = require('../../utils/logger');
const { closeOpenCheckouts } = require('../../services/openCheckouts');
const { canReceivePayouts } = require('../../utils/payouts');
const { cancelEvent } = require('../../services/eventCancellation');

/**
 * BRD §16 — every event is reviewed before the public can see it.
 *
 * Approve, or reject WITH A REASON. The reason is mandatory and is shown to the
 * organizer: a rejection they cannot act on is a support ticket, and the point
 * of the loop is that they fix it and resubmit without one.
 */

// ─── GET /admin/approvals ───────────────────────────────────────────────────
async function queue(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'starts_at', 'updated_at'],
      defaultSort: 'updated_at',
    });

    // Oldest waiting first by default — a review queue sorted newest-first
    // starves the events that have waited longest.
    const query = supabase
      .from('events')
      .select(`
        id, slug, title, status, country, currency, timezone, starts_at, ends_at,
        listing_type, created_at, updated_at,
        organizers ( id, display_name, country, stripe_onboarding_complete, stripe_payouts_enabled )
      `, { count: 'exact' })
      .eq('status', 'pending_review');

    const { data, error, count } = await applyPagination(
      query, { ...p, order: req.query.order === 'desc' ? 'desc' : 'asc' },
    );
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      country: e.country,
      currency: e.currency,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      // The queue printed every start time in UTC; an 8pm Toronto show read as
      // the next day.
      timezone: e.timezone,
      listingType: e.listing_type,
      submittedAt: e.updated_at,
      organizer: {
        id: e.organizers?.id,
        name: e.organizers?.display_name,
        country: e.organizers?.country,
        // Surfaced in the queue because approving a ticketed event whose
        // organizer cannot be paid produces a listing that takes money nobody
        // can collect. The reviewer should see it before deciding.
        canReceivePayouts: canReceivePayouts(e.organizers),
      },
    })), { pagination: buildMeta(p, count) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/events/:eventId/approve ────────────────────────────────────
async function approve(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, status, listing_type, terms_accepted_id, organizer_id, organizers ( is_banned )')
      .eq('id', req.params.eventId).maybeSingle();

    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (!events.canTransition(event.status, 'published')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `Only an event awaiting review can be approved — this one is ${event.status}.`,
      });
    }
    // A ban stops an organizer selling (BRD §19). An event submitted before the
    // ban was still approvable, and approving it put a new listing on sale for
    // exactly the organizer the ban was meant to stop.
    const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers;
    if (organizer?.is_banned) {
      return sendFail(res, {
        status: ERROR_STATUS.ORGANIZER_BANNED, error: 'ORGANIZER_BANNED',
        message: 'This organizer is banned from selling. Lift the ban first if this event should go on sale.',
      });
    }
    // The database enforces this too (published_requires_terms). Checking here
    // turns a constraint violation into a sentence a reviewer can act on.
    if (!event.terms_accepted_id) {
      return sendFail(res, {
        status: ERROR_STATUS.TERMS_NOT_ACCEPTED, error: 'TERMS_NOT_ACCEPTED',
        message: 'This event has no recorded terms acceptance and cannot be published.',
      });
    }

    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'published',
        rejection_reason: null,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      // Optimistic lock: two reviewers opening the same queue must not both
      // publish, and the second must be told rather than silently succeed.
      .eq('status', 'pending_review')
      .select('id, slug, status, reviewed_at')
      .single();

    if (error || !data) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'This event was already reviewed by someone else.',
      });
    }

    await audit(req, 'event.approved', event.id, {});
    logger.info({ eventId: event.id, by: req.user.id }, 'event approved');
    return sendOk(res, { id: data.id, slug: data.slug, status: data.status, reviewedAt: data.reviewed_at });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/events/:eventId/reject ─────────────────────────────────────
async function reject(req, res, next) {
  try {
    const reason = String(req.body.reason || '').trim();

    const { data: event } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).maybeSingle();

    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (!events.canTransition(event.status, 'rejected')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `Only an event awaiting review can be rejected — this one is ${event.status}.`,
      });
    }

    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      .eq('status', 'pending_review')
      .select('id, status, rejection_reason, reviewed_at')
      .single();

    if (error || !data) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'This event was already reviewed by someone else.',
      });
    }

    await audit(req, 'event.rejected', event.id, { reason });
    return sendOk(res, {
      id: data.id, status: data.status,
      rejectionReason: data.rejection_reason, reviewedAt: data.reviewed_at,
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/events/:eventId/suspend ────────────────────────────────────
/**
 * Suspending pulls a live event out of public view for a breach or a legal
 * problem, and is reversible. It is not a cancellation: the event may still
 * happen. Cancelling is also the admin's (BRD §17), and is terminal — below.
 */
async function suspend(req, res, next) {
  try {
    const reason = String(req.body.reason || '').trim();
    const { data: event } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).maybeSingle();

    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (!events.canTransition(event.status, 'suspended')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `An event that is ${event.status} cannot be suspended.`,
      });
    }

    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'suspended',
        suspended_at: new Date().toISOString(),
        suspended_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id).eq('status', 'published')
      .select('id, status, suspended_at, suspended_reason').single();

    if (error || !data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This event changed while you were reviewing it.' });
    }

    // Anyone still paying is stopped before the payment is taken.
    const checkouts = await closeOpenCheckouts(event.id);

    await audit(req, 'event.suspended', event.id, { reason, openCheckoutsClosed: checkouts.released });
    return sendOk(res, {
      id: data.id, status: data.status,
      suspendedAt: data.suspended_at, suspendedReason: data.suspended_reason,
      openCheckoutsClosed: checkouts.released,
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/events/:eventId/unsuspend ──────────────────────────────────
async function unsuspend(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('events')
      .update({
        status: 'published',
        suspended_at: null, suspended_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.eventId).eq('status', 'suspended')
      .select('id, status').single();

    if (error || !data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'That event is not suspended.' });
    }
    await audit(req, 'event.unsuspended', req.params.eventId, {});
    return sendOk(res, { id: data.id, status: data.status });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/events/:eventId/cancel ─────────────────────────────────────
/**
 * BRD §17 — only an admin cancels an event. The organizer can only ask (see
 * cancellation requests below). The work itself is `services/eventCancellation`,
 * shared with approving a request so the two can never drift apart.
 */
async function cancel(req, res, next) {
  try {
    const reason = String(req.body.reason || '').trim();
    const result = await cancelEvent({ eventId: req.params.eventId, reason, actorId: req.user.id });
    if (!result.ok) {
      return sendFail(res, { status: result.status, error: result.error, message: result.message });
    }

    await audit(req, 'event.cancelled', result.event.id,
      { reason, from: result.from, openCheckoutsClosed: result.openCheckoutsClosed });
    return sendOk(res, {
      id: result.event.id, status: result.event.status,
      cancelledAt: result.event.cancelled_at, cancelledReason: result.event.cancelled_reason,
      openCheckoutsClosed: result.openCheckoutsClosed,
    });
  } catch (err) {
    return next(err);
  }
}

// ═══ CANCELLATION REQUESTS ══════════════════════════════════════════════════
/**
 * An organizer asks, with a reason; a super admin decides. Approving cancels the
 * event through the same `cancelEvent` as the direct cancel. Rejecting needs a
 * note, because the organizer is told why — a bare "no" is a support ticket.
 */

// ─── GET /admin/cancellation-requests ───────────────────────────────────────
async function cancellationRequests(req, res, next) {
  try {
    const status = ['pending', 'approved', 'rejected', 'withdrawn', 'all'].includes(req.query.status)
      ? req.query.status : 'pending';
    let query = supabase
      .from('event_cancellation_requests')
      .select(`
        id, reason, status, decision_note, decided_at, created_at,
        events ( id, slug, title, status, starts_at, timezone, currency ),
        organizers ( id, display_name ),
        profiles!event_cancellation_requests_requested_by_fkey ( email, full_name )
      `)
      // Oldest first while pending — a queue sorted newest-first starves the
      // requests that have waited longest.
      .order('created_at', { ascending: status === 'pending' })
      .limit(200);
    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decision_note,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      event: r.events ? {
        id: r.events.id, slug: r.events.slug, title: r.events.title, status: r.events.status,
        startsAt: r.events.starts_at, timezone: r.events.timezone,
      } : null,
      organizer: { id: r.organizers?.id, name: r.organizers?.display_name },
      requestedBy: { email: r.profiles?.email, name: r.profiles?.full_name },
    })));
  } catch (err) {
    return next(err);
  }
}

/** The pending request, with who to tell — or a refusal ready to send. */
async function pendingRequest(requestId) {
  const { data, error } = await supabase
    .from('event_cancellation_requests')
    .select(`
      id, event_id, status, reason,
      events ( id, title ),
      organizers ( display_name, profiles!organizers_owner_user_id_fkey ( email ) )
    `)
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { refusal: { status: 404, error: 'NOT_FOUND', message: 'No such cancellation request.' } };
  if (data.status !== 'pending') {
    return { refusal: { status: 409, error: 'CONFLICT', message: `This request was already ${data.status}.` } };
  }
  return { request: data };
}

function tellOrganizer(request, { approved, note }) {
  const email = require('../../services/emailService');
  email.sendCancellationDecided({
    to: request.organizers?.profiles?.email,
    organizerName: request.organizers?.display_name,
    event: { title: request.events?.title || 'your event' },
    approved,
    note,
  }).catch((e) => logger.error({ err: e.message, requestId: request.id }, 'cancellation decision email failed'));
}

// ─── POST /admin/cancellation-requests/:requestId/approve ───────────────────
async function approveCancellation(req, res, next) {
  try {
    const { request, refusal } = await pendingRequest(req.params.requestId);
    if (refusal) return sendFail(res, refusal);

    const note = String(req.body.note || '').trim() || null;
    // The organizer's own words are the recorded reason: it is their event and
    // their explanation that buyers are owed.
    const result = await cancelEvent({ eventId: request.event_id, reason: request.reason, actorId: req.user.id });
    if (!result.ok) {
      return sendFail(res, { status: result.status, error: result.error, message: result.message });
    }

    // cancelEvent marked the request approved; the note is added on top.
    if (note) {
      await supabase.from('event_cancellation_requests')
        .update({ decision_note: note }).eq('id', request.id);
    }

    await audit(req, 'event.cancellation_approved', request.event_id, {
      requestId: request.id, reason: request.reason, note, from: result.from,
      openCheckoutsClosed: result.openCheckoutsClosed,
    });
    tellOrganizer(request, { approved: true, note });

    return sendOk(res, { id: request.id, status: 'approved', eventStatus: 'cancelled' });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /admin/cancellation-requests/:requestId/reject ────────────────────
async function rejectCancellation(req, res, next) {
  try {
    const { request, refusal } = await pendingRequest(req.params.requestId);
    if (refusal) return sendFail(res, refusal);

    const note = String(req.body.note).trim();
    const { data, error } = await supabase
      .from('event_cancellation_requests')
      .update({ status: 'rejected', decision_note: note, decided_by: req.user.id, decided_at: new Date().toISOString() })
      .eq('id', request.id)
      .eq('status', 'pending')   // optimistic lock: another admin may have decided
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'Someone decided this request while you were reading it.' });
    }

    await audit(req, 'event.cancellation_rejected', request.event_id, { requestId: request.id, note });
    tellOrganizer(request, { approved: false, note });

    return sendOk(res, { id: request.id, status: 'rejected' });
  } catch (err) {
    return next(err);
  }
}

/**
 * The audit trail (BRD §19).
 *
 * Never allowed to fail the action: an admin approving an event must not be
 * blocked because the audit insert had a bad day. The old version caught a
 * THROW, but supabase-js returns a refused insert as `{ error }` rather than
 * throwing, so the catch never ran. auditService reads the result.
 */
const { writeAudit } = require('../../services/auditService');

function audit(req, action, targetId, payload) {
  return writeAudit(req, { action, targetType: 'event', targetId, payload });
}

module.exports = {
  queue, approve, reject, suspend, unsuspend, cancel,
  cancellationRequests, approveCancellation, rejectCancellation,
};
