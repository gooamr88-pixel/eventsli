const { supabase } = require('../config/supabase');
const pricing = require('../services/pricingService');
const stripeSvc = require('../services/stripeService');
const tickets = require('../services/ticketService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');
const accessTokens = require('../services/accessTokens');
// Ticket delivery and retrieval live in one place; three callers need them and
// a second copy would drift.
const ticketCtrl = require('./ticketController');

const statusFor = (code) => ERROR_STATUS[code] || 400;

// ─── GET /public/reservations/:reservationId/quote ──────────────────────────
/**
 * Every amount the buyer will pay, itemised (BRD §04, §21).
 *
 * Recomputed from the database on each call rather than cached with the hold:
 * an admin can change the tax or commission while someone is at the checkout
 * screen, and the number they are shown must be the number they are charged.
 */
async function quote(req, res, next) {
  try {
    const q = await pricing.quoteReservation(req.params.reservationId);

    /**
     * The organizer's policies that they marked "show at checkout".
     *
     * BEFORE PAYING, not after asking. A refund policy a buyer never saw is one
     * that gets argued about afterwards, and the argument lands on the
     * organizer — which is why the flag exists and why this is on the quote
     * rather than a second request the checkout page might skip.
     *
     * Only the marked ones. Everything else is on the event page; repeating all
     * of it here would bury the one that matters.
     */
    const { data: policies } = await supabase
      .from('event_policies')
      .select('id, kind, title, body')
      .eq('event_id', q.event.id)
      .eq('show_at_checkout', true)
      .order('sort_order');

    return sendOk(res, {
      ...pricing.publicBreakdown(q),
      policies: (policies || []).map((p) => ({
        id: p.id, kind: p.kind, title: p.title, body: p.body,
      })),
    });
  } catch (err) {
    if (err.code) {
      return sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message });
    }
    return next(err);
  }
}

// ─── POST /public/reservations/:reservationId/checkout ──────────────────────
async function createSession(req, res, next) {
  try {
    if (!stripeSvc.enabled()) {
      return sendFail(res, {
        status: 503, error: 'FEATURE_DISABLED',
        message: 'Card payments are not available for this event right now.',
      });
    }

    const q = await pricing.quoteReservation(req.params.reservationId);

    // Guests must identify themselves — the ticket has to reach someone, and a
    // refund conversation with the organizer needs a name attached to it.
    const buyer = {
      userId: req.user?.id || null,
      name: (req.body.name || req.user?.access?.fullName || '').trim(),
      email: (req.body.email || req.user?.email || '').trim().toLowerCase(),
      phone: (req.body.phone || '').trim(),
    };
    if (!buyer.email) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: 'Enter an email address — your tickets are sent there.',
      });
    }

    // BRD §21 — the buyer sees and accepts the terms BEFORE paying. Refused
    // here, not only by the checkbox in the page: the route validator already
    // demands it, and this repeats the check so no other caller can skip it.
    if (req.body.acceptTerms !== true) {
      return sendFail(res, {
        status: 403, error: 'TERMS_NOT_ACCEPTED',
        message: 'Accept the terms to continue to payment.',
      });
    }

    // The organizer chose how this event is paid for. An event that takes only
    // manual payment has no card checkout, whatever the buyer's page sends.
    // Read on its own and FAIL OPEN on a read error: this column is new, and a
    // deploy that reaches the API before the migration must not stop every card
    // sale on the platform. Stripe onboarding is still checked just below.
    const { data: channels, error: channelError } = await supabase
      .from('events').select('accepts_stripe').eq('id', q.event.id).maybeSingle();
    if (channelError) {
      logger.error({ err: channelError.message, eventId: q.event.id }, 'could not read accepts_stripe; allowing card checkout');
    } else if (channels && channels.accepts_stripe === false) {
      return sendFail(res, {
        status: 503, error: 'FEATURE_DISABLED',
        message: 'This event does not take card payments. See the event page for how to pay.',
      });
    }

    const payable = await stripeSvc.organizerCanReceive(q.event.organizer_id);
    if (!payable.ok) {
      // The buyer is not told which organizer setting is missing — that is the
      // organizer's business, and it is not something the buyer can act on.
      logger.warn({ eventId: q.event.id, reason: payable.reason }, 'checkout blocked: organizer cannot receive');
      return sendFail(res, {
        status: 403, error: payable.reason,
        message: 'This event cannot take payments at the moment. Please try again later.',
      });
    }

    // Recorded against the version they were shown, and FAIL CLOSED. This used
    // to be `.catch(logger.warn)`: every guest acceptance failed (the table
    // required an account) and the payment went ahead regardless, so the rule
    // was recorded for nobody without one. A checkout we cannot evidence the
    // terms for does not start.
    const terms = require('../services/termsService');
    const current = await terms.currentVersion('buyer');
    await terms.accept({
      userId: buyer.userId,
      email: buyer.email,
      reservationId: req.params.reservationId,
      termsId: current.id,
      eventId: q.event.id,
      req,
    });

    const origin = safeOrigin(req);
    const session = await stripeSvc.createCheckoutSession({
      reservationId: req.params.reservationId,
      quote: q,
      buyer,
      origin,
      accountId: payable.accountId,
    });

    // Stashed so the webhook can attribute the order without trusting anything
    // the browser sends back — and with the session id, so an admin who cancels
    // or suspends the event can expire this checkout before it is paid
    // (services/openCheckouts.js).
    await supabase.from('reservations')
      .update({ attendee_data: { buyer, stripeSessionId: session.id } })
      .eq('id', req.params.reservationId);

    return sendOk(res, { checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    if (err.code && ERROR_STATUS[err.code]) {
      return sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message });
    }
    return next(err);
  }
}

/**
 * The redirect target must come from OUR allowlist, never from the request.
 *
 * `origin` and `referer` are attacker-controlled: echoing either into
 * success_url turns our checkout into an open redirect that a phishing page can
 * point at itself, wearing our domain in the link the buyer clicked.
 */
function safeOrigin(req) {
  const allowed = String(process.env.FRONTEND_URL || '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

  const claimed = String(req.headers.origin || '').replace(/\/$/, '');
  return allowed.includes(claimed) ? claimed : allowed[0] || 'http://localhost:3000';
}

// ─── GET /public/checkout/:sessionId ────────────────────────────────────────
/**
 * The success page.
 *
 * Fulfils synchronously if the webhook has not landed yet. The webhook is the
 * authority and will arrive, but it can be seconds behind the redirect, and a
 * buyer staring at "processing..." after paying assumes it failed. Both paths
 * call the same idempotent function, so whichever gets there first wins and the
 * other returns the same order.
 */
async function checkoutResult(req, res, next) {
  try {
    const session = await stripeSvc.retrieveSession(req.params.sessionId);

    if (session.payment_status !== 'paid') {
      return sendOk(res, { status: session.payment_status, order: null });
    }

    const reservationId = session.metadata?.reservation_id;
    const { data: existing } = await supabase
      .from('orders')
      .select('id, currency, buyer_total_cents, quantity')
      .eq('reservation_id', reservationId)
      .maybeSingle();

    let orderId = existing?.id;
    if (!orderId) {
      const result = await fulfillFromSession(session);
      if (!result.ok) {
        return sendFail(res, {
          status: statusFor(result.error), error: result.error, message: result.message,
        });
      }
      orderId = result.order_id;
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, currency, buyer_total_cents, quantity, guest_email, created_at, paid_at')
      .eq('id', orderId).single();

    /**
     * A Stripe session id is NOT a durable credential.
     *
     * It arrives in the URL bar, and from there it reaches browser history, the
     * `Referer` header of every third-party asset on the success page, and any
     * analytics running there. Serving QR codes to whoever holds one means
     * anyone who later reads that URL has a working ticket.
     *
     * So it buys a short window — long enough for the success page to render
     * and survive a refresh, and nothing after that. Beyond it the order still
     * shows, but the codes come from the emailed link or a signed-in account.
     */
    const paidAt = new Date(order.paid_at || order.created_at).getTime();
    const withinWindow = Date.now() - paidAt < ticketCtrl.SESSION_TICKET_WINDOW_MINUTES * 60_000;

    // Issued so the page can keep working without ever going back to the
    // session id — and so a refresh an hour later still shows the tickets.
    const accessToken = accessTokens.issueOrderToken(orderId);

    return sendOk(res, {
      status: 'paid',
      order: {
        id: order.id,
        currency: order.currency,
        totalCents: order.buyer_total_cents,
        // Masked. The success page already knows who is looking at it; printing
        // the full address means anyone who reads this URL learns it too.
        email: maskEmail(order.guest_email),
        createdAt: order.created_at,
      },
      accessToken,
      tickets: withinWindow ? await tickets.forOrder(orderId) : [],
      ticketsWithheld: !withinWindow,
      ...(withinWindow ? {} : {
        message: 'For security, entry codes are not shown on this link any more. '
               + 'Open the link in your confirmation email, or sign in to see them.',
      }),
    });
  } catch (err) { return next(err); }
}

/** `someone@example.com` → `so•••••@example.com` */
function maskEmail(addr) {
  if (!addr || !addr.includes('@')) return null;
  const [user, domain] = addr.split('@');
  const head = user.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(3, user.length - 2))}@${domain}`;
}

/**
 * Shared by the webhook and the success page.
 *
 * The breakdown is RECOMPUTED here rather than read from the session: what we
 * store must be what our own arithmetic says, and re-deriving it means a
 * tampered or stale session cannot write false numbers into the ledger.
 */
async function fulfillFromSession(session) {
  const reservationId = session.metadata?.reservation_id;
  if (!reservationId) {
    return { ok: false, error: 'VALIDATION_ERROR', message: 'That payment carries no reservation.' };
  }

  const { data: reservation } = await supabase
    .from('reservations').select('attendee_data, state').eq('id', reservationId).maybeSingle();

  // A hold already converted is the normal retry case, and quoteReservation
  // would refuse it. Let the RPC answer instead — it returns the original order.
  let breakdown = null;
  if (reservation?.state === 'active') {
    try {
      const q = await pricing.quoteReservation(reservationId);
      breakdown = q.breakdown;
    } catch (err) {
      // The quote refuses an event that is no longer on sale, and a hold that
      // has lapsed. Those used to THROW out of the webhook, so a payment for a
      // cancelled event was filed as "handler threw". Returned as a coded
      // refusal instead, so it is recorded as the specific thing it is.
      if (err.code) return { ok: false, error: err.code, message: err.message };
      throw err;
    }
  }

  const buyer = reservation?.attendee_data?.buyer || {};

  const { data: result, error } = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: reservationId,
    p_channel: 'stripe',
    p_breakdown: breakdown || {},
    p_buyer: {
      user_id: buyer.userId || null,
      name: buyer.name || session.customer_details?.name || null,
      email: buyer.email || session.customer_details?.email || null,
      phone: buyer.phone || null,
    },
    p_stripe: {
      session_id: session.id,
      payment_intent_id: typeof session.payment_intent === 'string'
        ? session.payment_intent : session.payment_intent?.id || null,
    },
  });

  if (error) {
    logger.error({ err: error.message, reservationId }, 'fulfilment failed');
    return { ok: false, error: 'CONFLICT', message: 'We could not complete that order.' };
  }

  // Deliver the tickets. Deliberately AFTER fulfilment and never awaited into
  // the result: the order is complete whether or not the email lands, and a
  // provider outage must not roll back a payment we have already taken.
  if (result?.ok && !result.already_fulfilled) {
    // One implementation, in ticketController. The copy that used to live here
    // embedded `profiles ( email )` on `orders`, which is ambiguous — there are
    // two foreign keys to profiles, `user_id` and `recorded_by` — so PostgREST
    // refused it and EVERY ticket email failed silently. It never surfaced
    // because this path only runs after a real Stripe fulfilment.
    ticketCtrl.sendTicketEmail(result.order_id).catch((e) =>
      logger.error({ err: e.message, orderId: result.order_id }, 'ticket email failed'));
  }
  return result;
}

// ─── POST /public/reservations/:reservationId/claim ─────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A FREE TICKET, claimed. No card, no Stripe, no payment intent.
 *
 * A separate endpoint from `createSession` rather than a branch inside it, and
 * the reason is what `createSession` spends its length doing: deciding whether
 * Stripe is switched on, whether this event takes cards, whether the organizer
 * can receive money, and building a redirect to a hosted page. Every one of
 * those questions is meaningless when the total is zero, and a `total === 0`
 * branch threaded through them would mean each future edit to the paid path has
 * to remember the free one exists.
 *
 * WHAT IS KEPT, deliberately, and is not ceremony:
 *
 *   • THE EMAIL. The ticket has to reach somebody, and a QR code with no
 *     address attached is a ticket nobody can be sent or re-sent.
 *   • THE TERMS (BRD §21). Free does not mean unconditional — the organizer's
 *     refund and admission policies still bind, and an event still has a
 *     capacity somebody is taking a place in. Recorded against the version
 *     shown, and FAILING CLOSED exactly as the paid path does.
 *
 * WHAT MAKES IT SAFE is the re-quote. The price is read from the database here,
 * not from the request and not from what the browser was shown — so a buyer who
 * reaches this endpoint for a paid reservation is refused rather than handed
 * free tickets. That check is the entire security boundary of this handler.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function claimFree(req, res, next) {
  try {
    const q = await pricing.quoteReservation(req.params.reservationId);

    /**
     * THE CHECK THIS ENDPOINT EXISTS AROUND.
     *
     * `buyerTotalCents` is recomputed from the database on every quote, so it
     * reflects the tier prices, the table prices, the promo code and the taxes
     * as they are right now. Anything above zero and this is a paid checkout
     * wearing the wrong URL — which is the one way this endpoint could give
     * away tickets, so it is refused before anything else happens.
     */
    if (Number(q.breakdown.buyerTotalCents) !== 0) {
      return sendFail(res, {
        status: 400, error: 'PAYMENT_REQUIRED',
        message: 'These tickets are not free. Continue to payment instead.',
      });
    }

    const buyer = {
      userId: req.user?.id || null,
      name: (req.body.name || req.user?.access?.fullName || '').trim(),
      email: (req.body.email || req.user?.email || '').trim().toLowerCase(),
      phone: (req.body.phone || '').trim(),
    };
    if (!buyer.email) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: 'Enter an email address — your tickets are sent there.',
      });
    }

    if (req.body.acceptTerms !== true) {
      return sendFail(res, {
        status: 403, error: 'TERMS_NOT_ACCEPTED',
        message: 'Accept the terms to claim your tickets.',
      });
    }

    // Same failure mode as the paid path: a claim we cannot evidence the terms
    // for does not happen.
    const terms = require('../services/termsService');
    const current = await terms.currentVersion('buyer');
    await terms.accept({
      userId: buyer.userId,
      email: buyer.email,
      reservationId: req.params.reservationId,
      termsId: current.id,
      eventId: q.event.id,
      req,
    });

    const { data: result, error } = await supabase.rpc('fulfill_checkout', {
      p_reservation_id: req.params.reservationId,
      // Not 'manual'. That channel is money the organizer collected themselves,
      // and filing free tickets under it fills their cash record with sales
      // that never happened. See 20260917115000.
      p_channel: 'free',
      p_breakdown: q.breakdown,
      p_buyer: {
        user_id: buyer.userId || null,
        name: buyer.name || null,
        email: buyer.email || null,
        phone: buyer.phone || null,
      },
      p_stripe: {},
    });

    if (error) {
      logger.error({ err: error.message, reservationId: req.params.reservationId }, 'free claim failed');
      return sendFail(res, {
        status: 409, error: 'CONFLICT', message: 'We could not complete that claim.',
      });
    }

    if (!result?.ok) {
      return sendFail(res, {
        status: statusFor(result?.error),
        error: result?.error || 'CONFLICT',
        message: result?.message || 'That hold is no longer available.',
      });
    }

    // After fulfilment and never awaited into the response: the tickets exist
    // whether or not the email lands, and a provider outage must not fail a
    // claim that has already taken the stock.
    if (!result.already_fulfilled) {
      ticketCtrl.sendTicketEmail(result.order_id).catch((e) =>
        logger.error({ err: e.message, orderId: result.order_id }, 'ticket email failed'));
    }

    return sendOk(res, {
      orderId: result.order_id,
      ticketCount: result.ticket_count,
      free: true,
      email: maskEmail(buyer.email),
    }, { status: 201 });
  } catch (err) {
    if (err.code && ERROR_STATUS[err.code]) {
      return sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message });
    }
    return next(err);
  }
}

module.exports = { quote, createSession, claimFree, checkoutResult, fulfillFromSession };
