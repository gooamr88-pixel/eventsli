const { supabase } = require('../../config/supabase');
const events = require('../../services/eventService');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail, ERROR_STATUS } = require('../../utils/responseEnvelope');
const logger = require('../../utils/logger');
const { closeOpenCheckouts } = require('../../services/openCheckouts');
const { canReceivePayouts } = require('../../utils/payouts');

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
 * BRD §17 — only an admin cancels an event. The organizer cannot.
 *
 * Nothing is deleted. Sold tickets stay, the event stays, and a buyer can still
 * see what they bought and that it was called off; deleting would destroy the
 * only record of a transaction that really happened.
 *
 * This moves no money and promises none. BRD §09 makes tickets non-refundable
 * by default and puts any refund between the organizer and the buyer, with
 * Eventsli not responsible for it — so no refund is issued or implied here.
 */
async function cancel(req, res, next) {
  try {
    const reason = String(req.body.reason || '').trim();
    const { data: event } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).maybeSingle();

    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (!events.canTransition(event.status, 'cancelled')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `An event that is ${event.status} cannot be cancelled.`,
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('events')
      .update({ status: 'cancelled', cancelled_at: now, cancelled_reason: reason, updated_at: now })
      .eq('id', event.id)
      .eq('status', event.status)   // optimistic lock: the event may have moved
      .select('id, status, cancelled_at, cancelled_reason')
      .single();

    if (error || !data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This event changed while you were reviewing it.' });
    }

    // Scanning stops immediately — a cancelled event must not admit anyone. Not
    // best-effort in spirit: logged at error level so a door left open is loud.
    const { error: lockError } = await supabase.from('scanner_access').upsert({
      event_id: event.id,
      is_locked: true,
      locked_reason: 'event_cancelled',
      locked_at: now,
      updated_at: now,
    }, { onConflict: 'event_id' });
    if (lockError) logger.error({ err: lockError, eventId: event.id }, 'CANCELLED EVENT SCANNER NOT LOCKED');

    // Anyone still on Stripe's page is stopped before they pay for an event
    // that is not going to happen. `fulfill_checkout` refuses the rest.
    const checkouts = await closeOpenCheckouts(event.id);

    await audit(req, 'event.cancelled', event.id,
      { reason, from: event.status, openCheckoutsClosed: checkouts.released });
    logger.info({ eventId: event.id, by: req.user.id }, 'event cancelled by admin');
    return sendOk(res, {
      id: data.id, status: data.status,
      cancelledAt: data.cancelled_at, cancelledReason: data.cancelled_reason,
      openCheckoutsClosed: checkouts.released,
    });
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

module.exports = { queue, approve, reject, suspend, unsuspend, cancel };
