const { supabase } = require('../config/supabase');
const stripeSvc = require('./stripeService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Close every checkout still open on an event that has just stopped selling —
 * cancelled or suspended by an admin (BRD §17).
 *
 * A buyer can be on Stripe's page at that moment. Expiring their Checkout
 * Session makes it unpayable, and releasing the hold puts the seats back. That
 * stops most of these payments being taken at all; `fulfill_checkout` refuses a
 * non-published event as the backstop for the few that complete anyway, and
 * the webhook files those for review.
 *
 * BEST EFFORT, BY DESIGN. The cancellation has already happened and must not be
 * undone because Stripe was slow or a session had just completed — so nothing
 * here throws, and every failure is logged at error level where an operator
 * will see it. A session that already completed cannot be expired; its payment
 * reaches the webhook and is refused there.
 *
 * Holds created before the session id was recorded on the reservation have no
 * id to expire; they are released, and the refusal covers them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function closeOpenCheckouts(eventId) {
  const summary = { holds: 0, expired: 0, released: 0, failed: 0 };

  const { data: holds, error } = await supabase
    .from('reservations')
    .select('id, attendee_data')
    .eq('event_id', eventId)
    .eq('state', 'active');

  if (error) {
    logger.error({ err: error.message, eventId }, 'could not list open checkouts for a stopped event');
    return summary;
  }

  summary.holds = (holds || []).length;
  const canExpire = stripeSvc.enabled();

  for (const hold of holds || []) {
    const sessionId = hold.attendee_data?.stripeSessionId;
    if (sessionId && canExpire) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await stripeSvc.expireSession(sessionId);
        summary.expired += 1;
      } catch (err) {
        summary.failed += 1;
        logger.error({ err: err.message, eventId, reservationId: hold.id },
          'could not expire a checkout on a stopped event — its payment will be refused and needs review');
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const { error: releaseError } = await supabase.rpc('release_reservation', { p_reservation_id: hold.id });
    if (releaseError) {
      summary.failed += 1;
      logger.error({ err: releaseError.message, eventId, reservationId: hold.id },
        'could not release a hold on a stopped event');
    } else {
      summary.released += 1;
    }
  }

  if (summary.holds) logger.warn({ eventId, ...summary }, 'open checkouts closed on a stopped event');
  return summary;
}

module.exports = { closeOpenCheckouts };
