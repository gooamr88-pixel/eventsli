const { supabase } = require('../config/supabase');
const events = require('./eventService');
const { closeOpenCheckouts } = require('./openCheckouts');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Cancelling an event — the one implementation.
 *
 * BRD §17: only an admin cancels. There are now two ways an admin does it — the
 * direct cancel from the console, and approving an organizer's cancellation
 * request — and both must do exactly the same things in the same order, so they
 * share this rather than a copy each.
 *
 * Nothing is deleted. Sold tickets stay, the event stays, and a buyer can still
 * see what they bought and that it was called off; deleting would destroy the
 * only record of a transaction that really happened.
 *
 * This moves no money and promises none. BRD §09 makes tickets non-refundable
 * by default and puts any refund between the organizer and the buyer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @returns {Promise<{ ok: true, event, from, openCheckoutsClosed }
 *                 | { ok: false, status, error, message }>}
 */
async function cancelEvent({ eventId, reason, actorId }) {
  const { data: event } = await supabase
    .from('events').select('id, status').eq('id', eventId).maybeSingle();

  if (!event) {
    return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' };
  }
  if (!events.canTransition(event.status, 'cancelled')) {
    return {
      ok: false, status: 409, error: 'CONFLICT',
      message: `An event that is ${event.status} cannot be cancelled.`,
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('events')
    .update({ status: 'cancelled', cancelled_at: now, cancelled_reason: reason, updated_at: now })
    .eq('id', event.id)
    .eq('status', event.status)   // optimistic lock: the event may have moved
    .select('id, title, status, cancelled_at, cancelled_reason, organizer_id')
    .single();

  if (error || !data) {
    return { ok: false, status: 409, error: 'CONFLICT', message: 'This event changed while you were reviewing it.' };
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

  // A still-open organizer request is answered by the cancellation itself, so
  // it does not sit in the queue asking for a decision already made.
  await supabase.from('event_cancellation_requests')
    .update({ status: 'approved', decided_by: actorId || null, decided_at: now })
    .eq('event_id', event.id)
    .eq('status', 'pending');

  logger.info({ eventId: event.id, by: actorId }, 'event cancelled by admin');
  return { ok: true, event: data, from: event.status, openCheckoutsClosed: checkouts.released };
}

module.exports = { cancelEvent };
