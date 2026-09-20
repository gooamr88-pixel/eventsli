const { supabase } = require('../config/supabase');
const stripeSvc = require('../services/stripeService');
const { fulfillFromSession } = require('./checkoutController');
const logger = require('../utils/logger');

// The event stopped selling while the buyer was paying (BRD §17). The money was
// taken and no tickets were issued: retrying will never change that, and a
// person has to decide what happens next.
const STOPPED_EVENT = new Set(['EVENT_CANCELLED', 'EVENT_SUSPENDED', 'EVENT_NOT_PUBLISHED']);
const PERMANENT = new Set(['RESERVATION_EXPIRED', 'RESERVATION_NOT_FOUND', ...STOPPED_EVENT]);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /payments/webhook
 *
 * Stripe's account of what happened, and the authority on it. Three rules
 * govern everything below:
 *
 *   1. VERIFY THE SIGNATURE FIRST, over the raw bytes. This endpoint is public
 *      and unauthenticated; without the signature anyone can post a
 *      "checkout.session.completed" and mint themselves free tickets.
 *
 *   2. EXACTLY ONCE. Stripe retries on any non-2xx, and delivers duplicates
 *      even without one. A unique row per Stripe event id is what makes a
 *      second delivery a no-op instead of a second order.
 *
 *   3. 2xx MEANS "STOP RETRYING". So a genuine failure must answer 5xx to keep
 *      the retries coming — and anything we cannot act on must answer 200, or
 *      Stripe redelivers it forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function webhook(req, res) {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // req.rawBody is captured by the express.json verify hook in app.js —
    // once the body has been parsed and re-serialised the signature is gone.
    event = stripeSvc.constructEvent(req.rawBody, signature);
  } catch (err) {
    logger.warn({ err: err.message }, 'webhook signature rejected');
    // 400, not 500: an unsigned or forged post is not a failure to retry.
    return res.status(400).json({ received: false, error: 'invalid signature' });
  }

  /**
   * ── Exactly once ──
   *
   * The insert is the claim. Two concurrent deliveries race on the primary key
   * and exactly one wins it; checking-then-inserting would let both through.
   *
   * WHAT THE INSERT NO LONGER PROMISES ON ITS OWN. Since the duplicate branch
   * below re-runs a delivery that was claimed but never finished, the loser of
   * that race can now fall through WHILE the winner is still in flight —
   * `processed_at` is null for both of them at that instant. So the insert is
   * the deduplicator for deliveries that are minutes apart, and it is no longer
   * the thing that serialises two that arrive together.
   *
   * That is safe because `fulfill_checkout` takes `FOR UPDATE` on the
   * reservation row: the second call blocks on the first, then finds the hold
   * already converted and returns the original order with `already_fulfilled`.
   * The ticket email is sent only when that flag is false, so the buyer does
   * not get two. The database lock is the real serialisation point, and it is
   * the only one that can be, because it is the only one both callers share.
   *
   * Every other branch below is a no-op on a second run: releasing a released
   * reservation, and logging a refund for review.
   */
  const { error: claimErr } = await supabase
    .from('webhook_events')
    .insert({ stripe_event_id: event.id, type: event.type, payload: event.data?.object || null });

  if (claimErr) {
    if (claimErr.code === '23505') {
      /**
       * SEEN BEFORE IS NOT THE SAME AS DONE BEFORE.
       *
       * This used to return 200 unconditionally, and that quietly cancelled
       * rule 3 below it. The claim row is written BEFORE the work, so a
       * delivery that failed half-way still leaves one — and every retry
       * Stripe then sent bounced off this branch and returned "duplicate"
       * without ever reaching the handler again. The `permanent ? 200 : 500`
       * decision further down was written to ask Stripe to come back after a
       * transient failure, and it could never be honoured: the second delivery
       * never got past here.
       *
       * Nothing else recovered it either. `webhook_events` is written here and
       * read by no job or screen, so the outcome was a charged buyer, no
       * tickets, and one line in a log.
       *
       * So the row is re-read and only a delivery that FINISHED CLEANLY —
       * processed, with no error recorded — is treated as a duplicate. Anything
       * else is picked back up. `fulfill_checkout` is idempotent and returns
       * the original order via `already_fulfilled`, which is what makes
       * reprocessing safe rather than a second charge's worth of tickets.
       */
      const { data: seen, error: readErr } = await supabase
        .from('webhook_events')
        .select('processed_at, error')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

      // Not knowing means not promising. Ask Stripe to try again rather than
      // acknowledging work we cannot confirm happened.
      if (readErr) {
        logger.error({ err: readErr.message, id: event.id }, 'could not re-read a claimed webhook event');
        return res.status(500).json({ received: false });
      }

      if (seen?.processed_at && !seen.error) {
        logger.debug({ id: event.id }, 'webhook already handled');
        return res.status(200).json({ received: true, duplicate: true });
      }

      // Claimed but unfinished, or finished with an error on the row. Fall
      // through and run it again.
      logger.warn({ id: event.id, previousError: seen?.error || null },
        'webhook was claimed but not completed — reprocessing');
    } else {
      // We could not record it, so we cannot promise not to double-process.
      // 5xx asks Stripe to try again.
      logger.error({ err: claimErr.message, id: event.id }, 'could not claim webhook event');
      return res.status(500).json({ received: false });
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.payment_status !== 'paid') {
          await mark(event.id, null);
          return res.status(200).json({ received: true, skipped: 'not paid' });
        }
        const result = await fulfillFromSession(session);
        if (!result.ok) {
          // Recorded on the row, not only in the log — this is the queue an
          // operator works from when a payment did not turn into tickets.
          await mark(event.id, result.message || result.error);
          // A hold that expired before the money landed, or an event that
          // stopped selling, will never fulfil, so retrying is pointless; it
          // needs a human. Anything else may be transient, so ask Stripe to
          // come back.
          const permanent = PERMANENT.has(result.error);
          if (STOPPED_EVENT.has(result.error)) {
            logger.error({ stripeEventId: event.id, sessionId: session.id, error: result.error },
              'PAYMENT TAKEN FOR AN EVENT THAT IS NO LONGER ON SALE — no tickets issued, needs review');
          }
          return res.status(permanent ? 200 : 500).json({ received: true, error: result.error });
        }
        await mark(event.id, null);
        logger.info({ orderId: result.order_id, tickets: result.ticket_count }, 'order fulfilled');
        return res.status(200).json({ received: true, orderId: result.order_id });
      }

      case 'checkout.session.expired': {
        // The buyer walked away. Put the seats back rather than waiting for the
        // sweeper — the difference is minutes of stock on a selling-out event.
        const reservationId = event.data.object.metadata?.reservation_id;
        if (reservationId) {
          await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
        }
        await mark(event.id, null);
        return res.status(200).json({ received: true });
      }

      case 'charge.refunded':
      case 'charge.dispute.created': {
        // Not automated. BRD §09 makes refunds an arrangement between organizer
        // and buyer, so this is recorded for an operator to act on rather than
        // silently reversing an order the platform did not decide to reverse.
        logger.warn({ type: event.type, id: event.id }, 'refund or dispute — needs review');
        await mark(event.id, null);
        return res.status(200).json({ received: true, review: true });
      }

      default:
        // Everything else is acknowledged so Stripe stops sending it.
        await mark(event.id, null);
        return res.status(200).json({ received: true, ignored: event.type });
    }
  } catch (err) {
    logger.error({ err: err.message, id: event.id, type: event.type }, 'webhook handler threw');
    // The message is recorded ON THE ROW, which is what now makes the retry
    // work: the duplicate branch at the top re-reads it, sees a non-null
    // `error`, and runs the handler again instead of acknowledging. A handler
    // that threw half-way is exactly the case Stripe's retries exist for, so
    // the 500 below is a real request to come back rather than a formality.
    await mark(event.id, err.message);
    return res.status(500).json({ received: false });
  }
}

async function mark(stripeEventId, error) {
  await supabase
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString(), error })
    .eq('stripe_event_id', stripeEventId);
}

module.exports = { webhook };
