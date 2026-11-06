const { supabase } = require('../config/supabase');
const pricing = require('../services/pricingService');
const { CHARGE_MODEL } = require('../utils/money');
const stripeSvc = require('../services/stripeService');
const checkoutSessions = require('../services/checkoutSessions');
const tickets = require('../services/ticketService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');
const accessTokens = require('../services/accessTokens');
// Ticket delivery and retrieval live in one place; three callers need them and
// a second copy would drift.
const ticketCtrl = require('./ticketController');

const statusFor = (code) => ERROR_STATUS[code] || 400;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS HOLD BELONGS TO THIS CALLER.
 *
 * `POST /hold` issues a `reservationToken` beside the reservation id, and both
 * `release` and the promo endpoints already demand it. The reason they do
 * applies here with more force: the id travels to the client and appears in the
 * checkout URL, so it is not a secret and it is not proof of anything.
 *
 * Without this check, anyone who comes by a reservation id can spend somebody
 * else's hold — and on a FREE event that is not even a self-limiting attack,
 * because `claim` issues the tickets to whatever address the caller supplies.
 * The rightful buyer's seats are gone and the tickets are in a stranger's inbox.
 *
 * Applied to the paid checkout too. The attacker there has to actually pay,
 * which makes it a nuisance rather than theft — but it is the same missing
 * check and the same three lines.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function ownsReservation(req) {
  return accessTokens.readReservationToken(accessTokens.fromRequest(req))
    === req.params.reservationId;
}

const NOT_YOURS = {
  status: 403,
  error: 'FORBIDDEN',
  message: 'That hold is not yours.',
};

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

    if (!ownsReservation(req)) return sendFail(res, NOT_YOURS);

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

    // Reuses a matching open session, lengthens the hold so the session cannot
    // outlive it, and records the buyer, the session id and what it charges —
    // the webhook attributes the order from that record rather than from
    // anything the browser sends back. See services/checkoutSessions.js.
    const origin = safeOrigin(req);
    const session = await checkoutSessions.openSession({
      reservationId: req.params.reservationId,
      quote: q,
      buyer,
      origin,
      accountId: payable.accountId,
    });

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
    // WHERE the session lives comes from OUR record of it, never from the URL:
    // a direct-charge session is on the organizer's account (T-074), and the
    // only trustworthy link from a session id to an account is the one we
    // wrote when we created it. A session id we never issued finds nothing.
    const located = await locateSession(req.params.sessionId);
    if (!located) {
      return sendFail(res, { status: 404, error: 'RESERVATION_NOT_FOUND', message: 'We could not find that checkout.' });
    }
    const session = await stripeSvc.retrieveSession(req.params.sessionId, located.accountId);

    if (session.payment_status !== 'paid') {
      return sendOk(res, { status: session.payment_status, order: null });
    }

    const reservationId = located.reservationId;
    const { data: existing } = await supabase
      .from('orders')
      .select('id, currency, buyer_total_cents, quantity')
      .eq('reservation_id', reservationId)
      .maybeSingle();

    let orderId = existing?.id;
    if (!orderId) {
      const result = await fulfillFromSession(session, { account: located.accountId });
      if (!result.ok) {
        return sendFail(res, {
          status: statusFor(result.error), error: result.error, message: result.message,
        });
      }
      orderId = result.order_id;
    }

    /**
     * THE EVENT, JOINED IN — because the success page never named it.
     *
     * The response carried the total, a masked email and the ticket stubs, and
     * not one word about WHAT had been bought. A buyer who was deciding between
     * two shows, or who came back to the tab after a detour, had nothing on the
     * screen that confirms their money went to the right event. The checkout
     * form one step earlier was given exactly this header for exactly this
     * reason; the page they land on after paying was left without it, and it is
     * the more important of the two — it is the receipt.
     *
     * The timezone comes with it so the stubs can print a scan time on the
     * VENUE's clock rather than the reader's.
     */
    const { data: order } = await supabase
      .from('orders')
      .select(`id, currency, buyer_total_cents, quantity, guest_email, created_at, paid_at,
               events ( id, title, slug, starts_at, ends_at, timezone, venue_name )`)
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

    /**
     * THE TOKEN IS INSIDE THE WINDOW TOO. It used to be issued unconditionally
     * here, one line below the comment explaining why the session id must stop
     * working — and it is a NINETY-DAY order token, so it handed back far more
     * than the window it sat next to was withholding. Anyone who later read the
     * session id out of history, a `Referer` or an analytics payload could
     * exchange it here for a token that opens `/public/t/:token` and every QR
     * code on the order, for a quarter of a year.
     *
     * That made the whole time-box decorative: `tickets` was emptied and the
     * key to the same tickets was returned beside it.
     *
     * A durable way back to the tickets already exists and is the one the
     * comment above points at — the token EMAILED to the buyer, issued in
     * `ticketController.sendTicketEmail`. That one is proof of holding the
     * address. This one was only ever proof of holding a URL.
     */
    const accessToken = withinWindow ? accessTokens.issueOrderToken(orderId) : null;

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
      event: order.events && {
        id: order.events.id,
        title: order.events.title,
        slug: order.events.slug,
        startsAt: order.events.starts_at,
        endsAt: order.events.ends_at,
        timezone: order.events.timezone,
        venue: order.events.venue_name,
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

/**
 * Our own record of a session we created: which reservation it is for, and
 * which organizer account it lives on. Null for a session id we never issued.
 */
async function locateSession(sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return null;
  const { data: order } = await supabase.from('orders')
    .select('reservation_id, stripe_account_id').eq('stripe_session_id', sessionId).maybeSingle();
  if (order) return { reservationId: order.reservation_id, accountId: order.stripe_account_id || null };
  const { data: hold, error } = await supabase.from('reservations')
    .select('id, attendee_data').eq('attendee_data->>stripeSessionId', sessionId).maybeSingle();
  if (error) throw new Error(`session lookup failed: ${error.message}`);
  if (!hold) return null;
  return { reservationId: hold.id, accountId: hold.attendee_data?.stripeAccountId || null };
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
 * The breakdown is never read from the Stripe session. It is the snapshot our
 * own arithmetic produced when the session was made (stored server-side on the
 * reservation), provided Stripe charged exactly that; otherwise a fresh quote.
 * Re-quoting alone recorded a different total from the one charged whenever
 * the quote moved after checkout opened (TECH-AUDIT-LOG T-012).
 */
async function fulfillFromSession(session, { account = null } = {}) {
  const reservationId = session.metadata?.reservation_id;
  if (!reservationId) {
    return { ok: false, error: 'VALIDATION_ERROR', message: 'That payment carries no reservation.' };
  }

  const { data: reservation, error: readError } = await supabase
    .from('reservations').select('attendee_data, state').eq('id', reservationId).maybeSingle();
  if (readError) throw new Error(`reservation lookup failed: ${readError.message}`);
  if (!reservation) {
    return { ok: false, error: 'RESERVATION_NOT_FOUND', message: 'That reservation no longer exists.' };
  }

  /**
   * ── THIS SESSION, ON THIS ACCOUNT, FOR THIS HOLD (TECH-AUDIT-LOG T-074) ──
   *
   * `metadata.reservation_id` is only a claim. Under direct charges every
   * organizer has a Stripe account of their own, so any of them can create a
   * Checkout Session with any metadata at all — and the signed webhook would
   * faithfully deliver it here. Trusting the metadata would let one organizer's
   * cheap charge issue tickets for another organizer's held seats.
   *
   * So a paid session counts only if it is the very session WE created for this
   * reservation, and it was paid on the account we created it on.
   * fulfill_checkout re-checks the account against the event's organizer.
   */
  const recordedSession = reservation.attendee_data?.stripeSessionId || null;
  const recordedAccount = reservation.attendee_data?.stripeAccountId || null;
  if (recordedSession !== session.id || (account || null) !== recordedAccount) {
    logger.error({
      reservationId, sessionId: session.id, account, recordedAccount,
      sessionMatches: recordedSession === session.id,
    }, 'PAID SESSION DOES NOT BELONG TO THIS RESERVATION OR ACCOUNT — not fulfilled, needs review');
    return { ok: false, error: 'FORBIDDEN', message: 'That payment was not made for this reservation.' };
  }

  // A hold already converted is the normal retry case, and quoteReservation
  // would refuse it. Let the RPC answer instead — it returns the original order.
  let breakdown = null;
  if (reservation?.state === 'active') {
    try {
      /**
       * ── THE DEPLOY WINDOW (TECH-AUDIT-LOG T-076) ──
       * A session with NO recorded organizer account was opened by the previous
       * release: a DESTINATION charge on the platform account, paid in the ~30
       * minutes either side of the deploy. Quoted as direct, fulfill_checkout
       * would refuse it for having no organizer account — a charged buyer with
       * no tickets. It is priced and recorded as what it actually is.
       */
      const legacy = !recordedAccount;
      const q = await pricing.quoteReservation(reservationId,
        legacy ? { chargeModel: CHARGE_MODEL.DESTINATION } : undefined);
      if (legacy) logger.warn({ reservationId, sessionId: session.id }, 'fulfilling a legacy destination-charge session');
      breakdown = checkoutSessions.breakdownForFulfilment({
        session,
        snapshot: reservation.attendee_data?.quote,
        requoted: q.breakdown,
      });
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
      // The organizer account the charge was made on (null for a legacy
      // destination charge). fulfill_checkout refuses a direct charge whose
      // account is not the event organizer's own.
      account_id: recordedAccount,
    },
  });

  if (error) {
    logger.error({ err: error.message, reservationId }, 'fulfilment failed');
    return { ok: false, error: 'CONFLICT', message: 'We could not complete that order.' };
  }
  if (result && result.ok === false && result.error === 'FORBIDDEN') {
    logger.error({ reservationId, sessionId: session.id, account: recordedAccount },
      'fulfil_checkout refused: the charge account is not this event organizer\'s — needs review');
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
    if (!ownsReservation(req)) return sendFail(res, NOT_YOURS);

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
