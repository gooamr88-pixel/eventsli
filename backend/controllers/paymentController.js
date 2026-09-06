const { supabase } = require('../config/supabase');
const stripeSvc = require('../services/stripeService');
const { fulfillFromSession } = require('./checkoutController');
const logger = require('../utils/logger');

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

  // ── Exactly once ──
  // The insert IS the claim. Two concurrent deliveries race on the primary key
  // and exactly one proceeds; checking-then-inserting would let both through.
  const { error: claimErr } = await supabase
    .from('webhook_events')
    .insert({ stripe_event_id: event.id, type: event.type, payload: event.data?.object || null });

  if (claimErr) {
    if (claimErr.code === '23505') {
      logger.debug({ id: event.id }, 'webhook already seen');
      return res.status(200).json({ received: true, duplicate: true });
    }
    // We could not record it, so we cannot promise not to double-process.
    // 5xx asks Stripe to try again.
    logger.error({ err: claimErr.message, id: event.id }, 'could not claim webhook event');
    return res.status(500).json({ received: false });
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
          // A hold that expired before the money landed will never fulfil, so
          // retrying is pointless; it needs a human. Anything else may be
          // transient, so ask Stripe to come back.
          const permanent = result.error === 'RESERVATION_EXPIRED'
                         || result.error === 'RESERVATION_NOT_FOUND';
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
    await mark(event.id, err.message);
    // The claim row stays, so a retry is deduplicated — but it also means a
    // retry will NOT reprocess. Clearing processed_at is what puts it back in
    // play; that is deliberate and manual, because a handler that threw
    // half-way needs looking at before it runs again.
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
