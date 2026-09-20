const { supabase } = require('../config/supabase');
const tickets = require('../services/ticketService');
const access = require('../services/accessTokens');
const email = require('../services/emailService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const QRCode = require('qrcode');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Getting a buyer to their tickets.
 *
 * Three ways in, and each one PROVES something:
 *
 *   GET /tickets            a session — you are the account that bought them
 *   GET /t/:token           a signed order token — it was emailed to you
 *   GET /public/checkout/…  a Stripe session id, briefly — you just paid
 *
 * The third is the weak one and is deliberately time-boxed: a Stripe session id
 * travels in the URL bar, browser history and `Referer` headers, so it buys a
 * short window right after payment and nothing after that. Long enough for the
 * success page to work and a refresh to survive; short enough that the id in
 * someone's history is not a ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// The window in which a Stripe session id alone will still yield QR codes.
const SESSION_TICKET_WINDOW_MINUTES = 30;

const asFailure = (res, err) => sendFail(res, {
  status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message,
});

// ─── GET /tickets ───────────────────────────────────────────────────────────
/**
 * Every ticket the signed-in buyer owns.
 *
 * Matched on the account AND on the email they used as a guest, so tickets
 * bought before signing up still appear once they register with that address.
 * Without that, a guest who later creates an account sees an empty list and
 * assumes their purchase vanished.
 */
async function mine(req, res, next) {
  try {
    /**
     * THE EMAIL IS QUOTED, because this is the one `or()` in the codebase
     * building a filter out of a value rather than out of a literal.
     *
     * Inside a PostgREST `or(...)` a comma ends the condition and a parenthesis
     * nests one, so an address containing either stops being a value and
     * becomes syntax — and the failure mode of a broken `or()` is a filter that
     * matches more than it should, on a query whose whole job is to return one
     * person's orders. Every other `or()` here runs its input through
     * `safeSearch` first; this one could not, because an email has to match
     * EXACTLY rather than be stripped of punctuation.
     *
     * Double-quoting is PostgREST's own answer: the value is read as a literal,
     * and the embedded quote and backslash escapes keep a crafted address from
     * closing it early. A quoted local part (`"a,b"@example.com`) is rare but
     * legal, and rarity is not a security boundary.
     */
    const quoted = `"${String(req.user.email ?? '').replace(/["\\]/g, (c) => `\\${c}`)}"`;

    const { data: orders } = await supabase
      .from('orders')
      .select('id, currency, buyer_total_cents, quantity, created_at, paid_at, guest_email, events ( id, title, slug, starts_at, ends_at, timezone, venue_name, status )')
      .eq('status', 'paid')
      .or(`user_id.eq.${req.user.id},guest_email.eq.${quoted}`)
      .order('created_at', { ascending: false })
      .limit(100);

    /**
     * ONE query for every order's tickets, not one per order.
     *
     * This loop used to call `forOrder` per order behind an
     * `eslint-disable no-await-in-loop`, so a buyer with a full page of orders
     * waited on up to a hundred sequential round trips to see a list they had
     * already been shown the totals for. The limit above bounds the set, which
     * is exactly what makes a single batched read the right shape.
     */
    const ticketsByOrder = await tickets.forOrders((orders || []).map((o) => o.id));

    const out = [];
    for (const order of orders || []) {
      out.push({
        orderId: order.id,
        event: order.events && {
          id: order.events.id,
          title: order.events.title,
          slug: order.events.slug,
          startsAt: order.events.starts_at,
          // Also selected above and also never returned. My tickets splits
          // Upcoming from Past on the END of the event, because a show that
          // started an hour ago has not happened yet to somebody standing
          // outside it — and that is exactly when they need the QR code.
          // Without this the split silently fell back to the start time and
          // filed the ticket under Past while the doors were open.
          endsAt: order.events.ends_at,
          // Selected above but never returned, so My tickets printed a Toronto
          // show in the reader's own zone.
          timezone: order.events.timezone,
          venue: order.events.venue_name,
          // BRD §17 — a cancelled event keeps its tickets and says so.
          cancelled: order.events.status === 'cancelled',
        },
        currency: order.currency,
        totalCents: order.buyer_total_cents,
        purchasedAt: order.paid_at || order.created_at,
        // Absent rather than empty is a real state — see `forOrders`.
        tickets: ticketsByOrder.get(order.id) ?? [],
      });
    }
    return sendOk(res, out);
  } catch (err) { return next(err); }
}

// ─── GET /public/t/:token ───────────────────────────────────────────────────
/**
 * The emailed link. The token IS the proof — it was sent to the address that
 * bought the tickets and nowhere else.
 */
async function byToken(req, res, next) {
  try {
    const orderId = access.readOrderToken(req.params.token);
    if (!orderId) {
      return sendFail(res, {
        status: 401, error: 'INVALID_TOKEN',
        message: 'That link is not valid any more. Check your email for a newer one.',
      });
    }
    return sendOk(res, await orderPayload(orderId));
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// ─── GET /public/qr/:token.png ──────────────────────────────────────────────
/**
 * The QR image for one ticket, drawn HERE.
 *
 * The ticket email used to point its <img> at a public QR-generating service,
 * with the signed admission token in the query string:
 *
 *     https://api.qrserver.com/v1/create-qr-code/?data=<the ticket token>
 *
 * Which handed a third party the credential that opens the door, for every
 * ticket we have ever sold, in a form sitting in their access logs. The token
 * carries no expiry by design — it is valid until the event — so anyone reading
 * those logs could render the code and walk in ahead of the buyer.
 *
 * `qrcode` was already a dependency. It was simply never wired up.
 *
 * The signature is checked before anything is drawn, so this is not a general
 * "turn any string into a QR image" endpoint hosted on our domain — that would
 * be a phishing tool with our name on it.
 */
async function qrImage(req, res, next) {
  try {
    const token = String(req.params.token || '').replace(/\.png$/i, '');
    const claims = tickets.decodeQrToken(token);
    if (!claims) {
      // A flat 404, not a 401: this is an <img> src, and the difference between
      // "forged" and "unknown" is not something to spell out to whoever asked.
      return res.status(404).end();
    }

    const png = await QRCode.toBuffer(token, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,          // scanned off a phone at a dark door, often cracked
      color: { dark: '#0E1613', light: '#FFFFFF' },
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      // Never cached by a proxy: the URL contains the admission credential.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'",
    });
    return res.end(png);
  } catch (err) { return next(err); }
}

// ─── POST /public/tickets/resend ────────────────────────────────────────────
/**
 * "I lost the email."
 *
 * Sends to the address ON THE ORDER, never to an address supplied in the
 * request — otherwise this endpoint mails anyone's tickets to anyone. The
 * caller must already know the buyer's address for it to do anything, and the
 * reply is identical either way so it cannot be used to test addresses.
 */
async function resend(req, res, next) {
  try {
    const addr = String(req.body.email || '').trim().toLowerCase();

    const { data: orders } = await supabase
      .from('orders')
      .select('id, guest_email, events ( id, title, slug, organizer_id )')
      .eq('status', 'paid')
      .eq('guest_email', addr)
      .order('created_at', { ascending: false })
      .limit(5);

    for (const order of orders || []) {
      // eslint-disable-next-line no-await-in-loop
      await sendTicketEmail(order.id).catch((e) =>
        logger.error({ err: e.message, orderId: order.id }, 'ticket resend failed'));
    }

    return sendOk(res, {
      sent: true,
      message: 'If that email has tickets, they are on their way.',
    });
  } catch (err) { return next(err); }
}

// ─── shared ─────────────────────────────────────────────────────────────────

async function orderPayload(orderId) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, currency, buyer_total_cents, quantity, guest_email, created_at, paid_at, events ( id, title, slug, starts_at, ends_at, timezone, venue_name, venue_address, status )')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    throw Object.assign(new Error('That order does not exist.'), { code: 'NOT_FOUND' });
  }

  return {
    orderId: order.id,
    event: order.events && {
      title: order.events.title,
      slug: order.events.slug,
      startsAt: order.events.starts_at,
      endsAt: order.events.ends_at,
      timezone: order.events.timezone,
      venue: { name: order.events.venue_name, address: order.events.venue_address },
      cancelled: order.events.status === 'cancelled',
    },
    currency: order.currency,
    totalCents: order.buyer_total_cents,
    purchasedAt: order.paid_at || order.created_at,
    tickets: await tickets.forOrder(order.id),
  };
}

/**
 * Sends the tickets for one order.
 *
 * Lives here rather than in the checkout controller because three callers need
 * it — fulfilment, the resend endpoint, and any future admin re-send — and a
 * second copy would drift.
 */
async function sendTicketEmail(orderId) {
  /**
   * The event's DATE, ZONE and VENUE are selected for the email, not for this
   * function's own logic.
   *
   * The ticket email named the event and nothing else — so the one message a
   * buyer is told to keep did not say when the event was or where. Somebody
   * searching their inbox a month later found a title and a QR code.
   */
  const { data: order } = await supabase
    .from('orders')
    .select(`id, currency, buyer_total_cents, guest_name, guest_email, user_id,
             events ( id, title, slug, organizer_id, starts_at, timezone, venue_name, city ),
             profiles!orders_user_id_fkey ( email )`)
    .eq('id', orderId)
    .maybeSingle();

  const to = order?.guest_email || order?.profiles?.email;
  if (!order || !to) return { sent: false, reason: 'no_recipient' };

  // `display_name` as well as the email: the buyer's ticket says who is putting
  // the event on, which is who they will be dealing with at the door.
  const { data: org } = await supabase
    .from('organizers')
    .select('display_name, profiles!organizers_owner_user_id_fkey ( email )')
    .eq('id', order.events.organizer_id)
    .maybeSingle();

  return email.sendTickets({
    to,
    buyerName: order.guest_name,
    event: { ...order.events, organizerName: org?.display_name || null },
    tickets: await tickets.forOrder(orderId),
    order,
    // A durable way back to the tickets that does not depend on the buyer
    // keeping the tab open, and does not put a Stripe session id in a link.
    accessToken: access.issueOrderToken(orderId),
    // BRD §09 puts refunds between the organizer and the buyer, so a reply has
    // to reach someone who can actually answer.
    organizerEmail: org?.profiles?.email,
  });
}

module.exports = {
  mine, byToken, qrImage, resend, orderPayload, sendTicketEmail,
  SESSION_TICKET_WINDOW_MINUTES,
};
