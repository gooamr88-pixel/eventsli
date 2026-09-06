const { supabase } = require('../../config/supabase');
const events = require('../../services/eventService');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const logger = require('../../utils/logger');

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
        id, slug, title, status, country, currency, starts_at, ends_at,
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
      listingType: e.listing_type,
      submittedAt: e.updated_at,
      organizer: {
        id: e.organizers?.id,
        name: e.organizers?.display_name,
        country: e.organizers?.country,
        // Surfaced in the queue because approving a ticketed event whose
        // organizer cannot be paid produces a listing that takes money nobody
        // can collect. The reviewer should see it before deciding.
        canReceivePayouts: !!(e.organizers?.stripe_onboarding_complete
                           && e.organizers?.stripe_payouts_enabled),
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
      .select('id, status, listing_type, terms_accepted_id, organizer_id')
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
    // The database enforces this too (published_requires_terms). Checking here
    // turns a constraint violation into a sentence a reviewer can act on.
    if (!event.terms_accepted_id) {
      return sendFail(res, {
        status: 409, error: 'TERMS_NOT_ACCEPTED',
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
 * BRD §17 — suspension is the admin's tool; cancellation is the organizer's.
 *
 * Suspending pulls a live event out of public view for a breach or a legal
 * problem, and is reversible. It does NOT tell buyers the event is off, because
 * as far as anyone knows it may still happen — only the organizer can say that.
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

    await audit(req, 'event.suspended', event.id, { reason });
    return sendOk(res, {
      id: data.id, status: data.status,
      suspendedAt: data.suspended_at, suspendedReason: data.suspended_reason,
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

/**
 * Best-effort audit trail (BRD §19).
 *
 * Never allowed to fail the action: an admin approving an event must not be
 * blocked because the audit insert had a bad day. Logged loudly instead so a
 * gap in the trail is visible rather than silent.
 */
async function audit(req, action, targetId, payload) {
  try {
    const { hashIp } = require('../../utils/crypto');
    await supabase.from('admin_audit').insert({
      actor_id: req.user.id,
      action,
      target_type: 'event',
      target_id: targetId,
      payload,
      ip_hash: hashIp(req.ip),
    });
  } catch (e) {
    logger.error({ err: e, action, targetId }, 'AUDIT WRITE FAILED — action proceeded');
  }
}

module.exports = { queue, approve, reject, suspend, unsuspend };
