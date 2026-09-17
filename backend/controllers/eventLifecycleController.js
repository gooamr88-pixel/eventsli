const { supabase } = require('../config/supabase');
const events = require('../services/eventService');
const { closeOpenCheckouts } = require('../services/openCheckouts');
const { writeAudit } = require('../services/auditService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { frontendOrigin } = require('../utils/frontendOrigin');
const logger = require('../utils/logger');
const { SELECT, shape, shapeCancellationRequest } = require('./eventController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What an organizer can do to an event as a whole: put it away, bring it back,
 * or ask Eventsli to cancel it.
 *
 * ARCHIVE is the organizer's own. It stops ticket sales at once (every sale
 * function refuses anything not `published`), takes the event off the public
 * site, and files it under "Archived" in their list. Tickets already sold stay
 * valid and still scan — archiving is housekeeping, not a cancellation, and a
 * buyer who paid is not told otherwise.
 *
 * CANCELLATION stays the admin's (BRD §17). The organizer asks, with a reason;
 * a super admin approves or rejects it in the console.
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function readEvent(eventId) {
  const { data, error } = await supabase.from('events').select(SELECT).eq('id', eventId).single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── POST /events/:eventId/archive ──────────────────────────────────────────
async function archive(req, res, next) {
  try {
    const event = await readEvent(req.params.eventId);

    if (!events.canTransition(event.status, 'archived')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: event.status === 'suspended'
          ? 'Eventsli has suspended this event, so it cannot be archived. Contact us about it.'
          : `An event that is ${event.status} cannot be archived.`,
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('events')
      .update({ status: 'archived', archived_at: now, archived_from: event.status, updated_at: now })
      .eq('id', event.id)
      .eq('status', event.status)   // optimistic lock
      .select(SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This event changed a moment ago. Reload and try again.' });
    }

    // Someone may be on Stripe's page right now. Their session is expired and
    // their seats released; `fulfill_checkout` refuses a payment that lands anyway.
    let openCheckoutsClosed = 0;
    if (event.status === 'published') {
      openCheckoutsClosed = (await closeOpenCheckouts(event.id)).released;
    }

    await writeAudit(req, {
      action: 'event.archived', targetType: 'event', targetId: event.id,
      payload: { from: event.status, openCheckoutsClosed },
    });
    return sendOk(res, shape(data));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /events/:eventId/restore ──────────────────────────────────────────
async function restore(req, res, next) {
  try {
    const event = await readEvent(req.params.eventId);
    if (event.status !== 'archived') {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This event is not archived.' });
    }

    const target = events.restoreTarget({ archivedFrom: event.archived_from, endsAt: event.ends_at });
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('events')
      .update({ status: target, archived_at: null, archived_from: null, updated_at: now })
      .eq('id', event.id)
      .eq('status', 'archived')
      .select(SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This event changed a moment ago. Reload and try again.' });
    }

    await writeAudit(req, {
      action: 'event.restored', targetType: 'event', targetId: event.id,
      payload: { to: target, archivedFrom: event.archived_from },
    });
    return sendOk(res, shape(data), { meta: { restoredTo: target } });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /events/:eventId/cancellation-request ─────────────────────────────
async function requestCancellation(req, res, next) {
  try {
    const event = await readEvent(req.params.eventId);
    if (!events.canTransition(event.status, 'cancelled')) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `This event is ${event.status}, so there is nothing to cancel.`,
      });
    }

    const reason = String(req.body.reason).trim();
    const { data, error } = await supabase
      .from('event_cancellation_requests')
      .insert({
        event_id: event.id,
        organizer_id: event.organizer_id || req.user.access.organizerId,
        requested_by: req.user.id,
        reason,
      })
      .select('id, reason, status, decision_note, decided_at, created_at')
      .single();

    if (error) {
      // The partial unique index: one pending request per event.
      if (error.code === '23505') {
        return sendFail(res, {
          status: 409, error: 'CANCELLATION_PENDING',
          message: 'You already asked to cancel this event. Eventsli is reviewing it.',
        });
      }
      throw new Error(error.message);
    }

    await writeAudit(req, {
      action: 'event.cancellation_requested', targetType: 'event', targetId: event.id,
      payload: { requestId: data.id, reason },
    });
    notifySuperAdmins({ req, event, reason }).catch((e) =>
      logger.error({ err: e.message, eventId: event.id }, 'cancellation request email failed'));

    return sendOk(res, shapeCancellationRequest(data), { status: 201 });
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /events/:eventId/cancellation-request ───────────────────────────
/** Changed their mind before Eventsli decided. */
async function withdrawCancellation(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('event_cancellation_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString(), decided_by: req.user.id })
      .eq('event_id', req.params.eventId)
      .eq('status', 'pending')
      .select('id, reason, status, decision_note, decided_at, created_at')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'There is no open cancellation request to withdraw.' });
    }
    await writeAudit(req, {
      action: 'event.cancellation_withdrawn', targetType: 'event', targetId: req.params.eventId,
      payload: { requestId: data.id },
    });
    return sendOk(res, shapeCancellationRequest(data));
  } catch (err) {
    return next(err);
  }
}

/**
 * Tells every super admin — the decision is theirs. Best effort: the request is
 * recorded and visible in the console whether or not an email arrives.
 */
async function notifySuperAdmins({ req, event, reason }) {
  const email = require('../services/emailService');
  const [{ data: admins }, { data: org }] = await Promise.all([
    supabase.from('profiles').select('email').eq('role', 'super_admin').eq('is_blocked', false),
    supabase.from('organizers').select('display_name').eq('id', event.organizer_id).maybeSingle(),
  ]);
  const url = `${frontendOrigin(req.headers.origin)}/admin/cancellations`;
  await Promise.all((admins || []).map((a) => email.sendCancellationRequested({
    to: a.email, organizerName: org?.display_name, event, reason, url,
  })));
}

module.exports = { archive, restore, requestCancellation, withdrawCancellation };
