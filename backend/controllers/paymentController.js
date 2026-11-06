const { supabase } = require('../config/supabase');
const stripeSvc = require('../services/stripeService');
const { fulfillFromSession } = require('./checkoutController');
const logger = require('../utils/logger');

// The event stopped selling while the buyer was paying (BRD §17). The money was
// taken and no tickets were issued: retrying will never change that, and a
// person has to decide what happens next.
const STOPPED_EVENT = new Set(['EVENT_CANCELLED', 'EVENT_SUSPENDED', 'EVENT_NOT_PUBLISHED']);
// FORBIDDEN: the session was not created by us for that hold, or was paid on an
// account that is not the event organizer's (T-074). Never fulfilled; a person
// looks at it. Retrying will not change the answer.
const PERMANENT = new Set(['RESERVATION_EXPIRED', 'RESERVATION_NOT_FOUND', 'FORBIDDEN', ...STOPPED_EVENT]);

/** The PaymentIntent id on a charge or session, whether expanded or not. */
const piId = (pi) => (typeof pi === 'string' ? pi : pi?.id || null);

/**
 * What a charge.dispute.* event means for the ledger.
 *   funds_withdrawn  → Stripe took the disputed amount from the organizer
 *   funds_reinstated → Stripe gave it back (dispute won)
 */
const DISPUTE_MOVEMENT = {
  'charge.dispute.funds_withdrawn': 'withdrawn',
  'charge.dispute.funds_reinstated': 'reinstated',
};

/**
 * After the sale, for a DIRECT charge on the organizer's account (T-074).
 * The organizer refunds and answers disputes in their own Stripe Dashboard;
 * these record what happened so the order, its tickets and the ledger agree
 * with Stripe. Each RPC is idempotent and checks `event.account` against the
 * order's own account, so one organizer's events cannot touch another's orders.
 */
/**
 * ── STRIPE DOES NOT ORDER EVENTS ──
 *
 * A refund or dispute can arrive before the payment's own
 * `checkout.session.completed` (seen with real delivery, 2026-11-06: a dispute
 * one second ahead of its payment). Answered with "no such order", it was
 * acknowledged and lost for good — a chargeback the ledger never saw.
 *
 * So when the order is missing, fulfil the payment FIRST, through the same
 * path and the same checks as the checkout webhook (our recorded session, on
 * this account), then record the event. A charge we did not create — an
 * organizer's own sale outside Eventsli — finds no session of ours and is
 * still ignored. If fulfilment cannot happen yet, throw: a 500 makes Stripe
 * redeliver, by which time it can.
 */
async function withOrder(event, paymentIntentId, record) {
  const first = await record();
  if (!(first && first.ok === false && first.error === 'ORDER_NOT_FOUND')) return first;
  if (!event.account || !paymentIntentId) return first;

  const session = await stripeSvc.sessionForPaymentIntent(paymentIntentId, event.account);
  if (!session || session.payment_status !== 'paid') return first;   // not one of ours

  const fulfilled = await fulfillFromSession(session, { account: event.account });
  if (!fulfilled.ok) {
    if (PERMANENT.has(fulfilled.error)) return { ok: false, error: fulfilled.error };
    throw new Error(`could not fulfil ahead of ${event.type}: ${fulfilled.error}`);
  }
  logger.info({ type: event.type, orderId: fulfilled.order_id }, 'fulfilled a payment ahead of its own checkout event');
  return record();
}

async function recordAfterSale(event) {
  const obj = event.data.object;

  if (event.type === 'charge.refunded') {
    const pi = piId(obj.payment_intent);
    return withOrder(event, pi, async () => {
      const { data, error } = await supabase.rpc('record_stripe_refund', {
        p_payment_intent_id: pi,
        p_account_id: event.account || null,
        p_charge_id: obj.id,
        p_amount_refunded_cents: obj.amount_refunded,
      });
      if (error) throw new Error(`record_stripe_refund: ${error.message}`);
      return data;
    });
  }

  if (event.type.startsWith('charge.dispute.')) {
    const pi = piId(obj.payment_intent);
    return withOrder(event, pi, async () => {
      const { data, error } = await supabase.rpc('record_stripe_dispute', {
        p_payment_intent_id: pi,
        p_account_id: event.account || null,
        p_charge_id: typeof obj.charge === 'string' ? obj.charge : obj.charge?.id || null,
        p_dispute_id: obj.id,
        p_status: obj.status,
        p_amount_cents: obj.amount,
        p_movement: DISPUTE_MOVEMENT[event.type] || null,
      });
      if (error) throw new Error(`record_stripe_dispute: ${error.message}`);
      return data;
    });
  }

  if (event.type === 'application_fee.refunded') {
    // A PLATFORM event: our fee on a direct charge, given back. The fee names
    // the organizer account and the charge; the charge names the order.
    const accountId = typeof obj.account === 'string' ? obj.account : obj.account?.id;
    const chargeId = typeof obj.charge === 'string' ? obj.charge : obj.charge?.id;
    const charge = await stripeSvc.retrieveCharge(chargeId, accountId);
    const { data, error } = await supabase.rpc('record_application_fee_refund', {
      p_payment_intent_id: piId(charge.payment_intent),
      p_account_id: accountId,
      p_fee_refunded_cents: obj.amount_refunded,
    });
    if (error) throw new Error(`record_application_fee_refund: ${error.message}`);
    return data;
  }
  return null;
}

/**
 * The one way an EXPIRED session may release a hold: it is the session we
 * recorded for that hold, on the account we recorded. Otherwise any organizer
 * could expire a session of their own carrying a stranger's reservation id and
 * put that buyer's seats back on sale mid-checkout.
 */
async function sessionIsOurs(session, account) {
  const reservationId = session.metadata?.reservation_id;
  if (!reservationId) return null;
  const { data } = await supabase.from('reservations')
    .select('attendee_data').eq('id', reservationId).maybeSingle();
  const rec = data?.attendee_data || {};
  return rec.stripeSessionId === session.id && (rec.stripeAccountId || null) === (account || null)
    ? reservationId : null;
}

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
        // `event.account` is set by Stripe on every event from a connected
        // account — the organizer's account the direct charge was made on.
        const result = await fulfillFromSession(session, { account: event.account || null });
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
        const reservationId = await sessionIsOurs(event.data.object, event.account);
        if (reservationId) {
          const { error: relErr } = await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
          if (relErr) throw new Error(`release_reservation: ${relErr.message}`);
        } else if (event.data.object.metadata?.reservation_id) {
          logger.warn({ id: event.id, sessionId: event.data.object.id, account: event.account || null },
            'expired session is not the one recorded for its reservation — hold left alone');
        }
        await mark(event.id, null);
        return res.status(200).json({ received: true });
      }

      case 'charge.refunded':
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated':
      case 'application_fee.refunded': {
        // BRD §09: refunds and disputes are between organizer and buyer — the
        // organizer acts in their own Stripe Dashboard, on their own balance.
        // This records the outcome; it never initiates or reverses anything.
        const outcome = await recordAfterSale(event);
        if (outcome && outcome.ok === false) {
          // ORDER_NOT_FOUND: a charge we did not create (e.g. the organizer's
          // own non-Eventsli sale). FORBIDDEN: an account that is not the
          // order's. Neither is retryable; both are worth a line in the log.
          logger.warn({ type: event.type, id: event.id, account: event.account || null, error: outcome.error },
            'after-sale event not applied to any order');
        } else if (outcome?.tickets_voided) {
          logger.info({ type: event.type, orderId: outcome.order_id, voided: outcome.tickets_voided },
            'tickets voided after refund or lost dispute');
        }
        await mark(event.id, outcome && outcome.ok === false ? outcome.error : null);
        return res.status(200).json({ received: true, outcome: outcome?.ok === false ? outcome.error : 'recorded' });
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
