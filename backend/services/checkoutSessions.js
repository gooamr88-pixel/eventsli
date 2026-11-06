const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const stripeSvc = require('./stripeService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE Stripe Checkout Session per hold, and it never outlives the hold.
 *
 * Three bugs lived in the gap between "a hold" and "a Checkout Session for it"
 * (docs/TECH-AUDIT-LOG.md T-010, T-011, T-012):
 *
 *  1. The session expired 30 minutes after "Pay" was clicked, while the hold
 *     expired 35 minutes after the seats were picked. Click Pay at minute 20
 *     and the Stripe page stayed payable until minute 50 — fifteen minutes
 *     after the sweeper had put the seats back on sale. The card was charged,
 *     fulfilment refused the lapsed hold, and nobody got a ticket.
 *
 *  2. The idempotency key was the reservation id alone, sent with an
 *     `expires_at` taken from the clock. Stripe refuses a reused key whose
 *     parameters differ, so the second "Pay" on a hold — back from Stripe's
 *     page, a retry, a corrected email — was a 500 for the key's 24 hours.
 *
 *  3. Nothing tied the session's amount to the hold afterwards. Applying or
 *     removing a code after the session existed changed what fulfilment
 *     recorded but not what Stripe charged — and removing a single-use code
 *     freed it for the next buyer while this one paid the discounted price.
 *
 * The rules that close them, all here so the three callers cannot drift:
 *
 *  - Before a session is made, the hold is extended so that it outlasts the
 *    session by SESSION_MARGIN_MIN. A hold is only ever lengthened, never
 *    shortened, so a session made under it can never outlive it. The extension
 *    is bounded by MAX_HOLD_LIFE_MIN from when the hold was made, so "Pay" is
 *    not a way to keep seats off sale indefinitely.
 *  - An open session whose amount and currency still match the quote is
 *    REUSED. A stale one is expired before a new one is made.
 *  - The idempotency key is derived from every parameter that varies, so a
 *    double-click gets the same session and a changed request gets a new one.
 *  - What the session charges is snapshotted on the reservation. Fulfilment
 *    records that snapshot, so the ledger matches what Stripe took.
 *  - Changing the promo code, or releasing the hold, first makes any open
 *    session unpayable. A session that has already been paid refuses both.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MIN = 60 * 1000;

/** Stripe refuses a Checkout Session that expires sooner than this. */
const STRIPE_MIN_SESSION_MIN = 30;
/** The hold outlives its session by this much — the webhook's time to land. */
const SESSION_MARGIN_MIN = 5;
/** What an extended hold is set to, measured from the click. */
const HOLD_AT_CHECKOUT_MIN = 40;

function holdTtlMinutes() {
  const ttl = parseInt(process.env.RESERVATION_TTL_MINUTES || '35', 10);
  return Number.isFinite(ttl) ? ttl : 35;
}

/** A hold may not be kept alive past this, however often "Pay" is pressed. */
function maxHoldLifeMinutes() {
  return holdTtlMinutes() + 45;
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Pure: what the hold needs to become, if anything, for a session made `now`.
 *
 *   { ok: true, extendTo: null }   the hold already covers a session
 *   { ok: true, extendTo: Date }   lengthen it to this first
 *   { ok: false }                  it cannot be lengthened enough
 */
function planHold({ expiresAt, createdAt, now }) {
  const needed = now + (STRIPE_MIN_SESSION_MIN + SESSION_MARGIN_MIN + 1) * MIN;
  if (expiresAt >= needed) return { ok: true, extendTo: null };

  const extendTo = now + HOLD_AT_CHECKOUT_MIN * MIN;
  const cap = createdAt + maxHoldLifeMinutes() * MIN;
  if (extendTo > cap) return { ok: false };
  return { ok: true, extendTo: new Date(extendTo) };
}

/** Pure: the session's expiry for a hold ending at `holdExpiresAt` (unix seconds). */
function sessionExpiryFor(holdExpiresAt) {
  return Math.floor((holdExpiresAt - SESSION_MARGIN_MIN * MIN) / 1000);
}

/**
 * Pure: the idempotency key for exactly these parameters.
 *
 * The same request twice is the same session; anything that changes what is
 * charged, to whom, or until when, is a different request.
 */
function idempotencyKey(reservationId, params) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32);
  return `checkout_${reservationId}_${digest}`;
}

/** Pure: may this existing session be handed out again for this quote? */
function isReusable(session, { buyerTotalCents, currency, holdExpiresAt }) {
  if (!session || session.status !== 'open') return false;
  if (session.amount_total !== buyerTotalCents) return false;
  if (String(session.currency || '').toLowerCase() !== String(currency || '').toLowerCase()) return false;
  // Never hand out a session that would outlive the hold it pays for.
  if (!session.expires_at || session.expires_at * 1000 > holdExpiresAt - SESSION_MARGIN_MIN * MIN + 1000) return false;
  return true;
}

async function readReservation(reservationId) {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, state, expires_at, created_at, attendee_data')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  if (!data) throw fail('RESERVATION_NOT_FOUND', 'That hold no longer exists.');
  return data;
}

/**
 * Lengthens the hold, if needed, so a session made now cannot outlive it.
 * Returns the hold's expiry (ms).
 *
 * The UPDATE is conditional on the hold still being active, unexpired and
 * still too short. Two clicks racing both arrive here: one lengthens it, the
 * other matches no row, re-reads, and finds it long enough. The sweeper's
 * `UPDATE … WHERE expires_at < now()` re-checks its WHERE after the row lock,
 * so it cannot expire a hold this has just lengthened.
 */
async function ensureHoldCoversSession(reservation, now = Date.now()) {
  const expiresAt = new Date(reservation.expires_at).getTime();
  if (reservation.state !== 'active' || expiresAt <= now) {
    throw fail('RESERVATION_EXPIRED', 'Your hold has expired. Please choose your seats again.');
  }

  const plan = planHold({ expiresAt, createdAt: new Date(reservation.created_at).getTime(), now });
  if (!plan.ok) {
    throw fail('RESERVATION_EXPIRED',
      'There is not enough time left on your hold to pay. Please choose your seats again.');
  }
  if (!plan.extendTo) return expiresAt;

  const neededIso = new Date(now + (STRIPE_MIN_SESSION_MIN + SESSION_MARGIN_MIN + 1) * MIN).toISOString();
  const { data: updated, error } = await supabase
    .from('reservations')
    .update({ expires_at: plan.extendTo.toISOString() })
    .eq('id', reservation.id)
    .eq('state', 'active')
    .gt('expires_at', new Date(now).toISOString())
    .lt('expires_at', neededIso)
    .select('expires_at')
    .maybeSingle();
  if (error) throw new Error(`could not extend the hold: ${error.message}`);
  if (updated) return new Date(updated.expires_at).getTime();

  // Matched nothing: another request lengthened it, or it lapsed. Ask again.
  const fresh = await readReservation(reservation.id);
  const freshExpiry = new Date(fresh.expires_at).getTime();
  if (fresh.state === 'active' && freshExpiry >= new Date(neededIso).getTime()) return freshExpiry;
  throw fail('RESERVATION_EXPIRED', 'Your hold has expired. Please choose your seats again.');
}

/**
 * Makes any open session on this hold unpayable and forgets it, before the
 * hold's price or existence changes. Refuses if that session has been paid —
 * its fulfilment is on its way, and changing the hold under it would charge a
 * card for seats that were just given back.
 *
 * FAILS CLOSED: if Stripe cannot be asked, the change does not happen.
 */
async function closeOpenSession(reservationId) {
  const reservation = await readReservation(reservationId);
  const sessionId = reservation.attendee_data?.stripeSessionId;
  if (!sessionId) return { closed: false };
  if (!stripeSvc.enabled()) return { closed: false };
  // A direct-charge session lives on the ORGANIZER's account (T-074).
  const accountId = reservation.attendee_data?.stripeAccountId;

  const session = await stripeSvc.retrieveSession(sessionId, accountId);
  if (session.status === 'complete') {
    throw fail('CONFLICT', 'This hold has already been paid for. Check your email for your tickets.');
  }
  if (session.status === 'open') {
    try {
      await stripeSvc.expireSession(sessionId, accountId);
    } catch (err) {
      // It may have completed between the two calls. Look once more.
      const again = await stripeSvc.retrieveSession(sessionId, accountId);
      if (again.status === 'complete') {
        throw fail('CONFLICT', 'This hold has already been paid for. Check your email for your tickets.');
      }
      if (again.status === 'open') throw err;
    }
  }

  const {
    stripeSessionId, stripeAccountId, quote, ...rest
  } = reservation.attendee_data || {};
  const { error } = await supabase.from('reservations')
    .update({ attendee_data: rest })
    .eq('id', reservationId);
  if (error) logger.error({ err: error.message, reservationId }, 'expired a checkout but could not forget its id');
  return { closed: true };
}

/**
 * The Checkout Session for this hold: the open one if it still matches, or a
 * new one. Returns `{ url, id, reused }`.
 */
async function openSession({ reservationId, quote, buyer, origin, accountId }) {
  const b = quote.breakdown;
  const currency = String(quote.event.currency).toLowerCase();
  let reservation = await readReservation(reservationId);
  const existingId = reservation.attendee_data?.stripeSessionId;

  if (existingId) {
    const existingAccount = reservation.attendee_data?.stripeAccountId;
    const existing = await stripeSvc.retrieveSession(existingId, existingAccount);
    if (existing.status === 'complete') {
      // Paid already — send them to the receipt rather than to a second charge.
      return { id: existing.id, url: `${origin}/checkout/success?session_id=${existing.id}`, reused: true };
    }
    const stored = reservation.attendee_data?.buyer || {};
    const sameBuyer = ['userId', 'name', 'email', 'phone']
      .every((k) => (stored[k] || null) === (buyer[k] || null));
    // Same organizer account too: a session on an account the organizer has
    // since replaced must not be handed out.
    if (sameBuyer && existingAccount === accountId && isReusable(existing, {
      buyerTotalCents: b.buyerTotalCents,
      currency,
      holdExpiresAt: new Date(reservation.expires_at).getTime(),
    })) {
      return { id: existing.id, url: existing.url, reused: true };
    }
    // Stale: a different amount, buyer or expiry. Close it before opening another.
    await closeOpenSession(reservationId);
    reservation = await readReservation(reservationId);
  }

  const holdExpiresAt = await ensureHoldCoversSession(reservation);
  const expiresAt = sessionExpiryFor(holdExpiresAt);

  const key = idempotencyKey(reservationId, {
    amount: b.buyerTotalCents,
    fee: b.applicationFeeCents,
    currency,
    accountId,
    origin,
    expiresAt,
    email: buyer.email || '',
    name: buyer.name || '',
    phone: buyer.phone || '',
  });

  const session = await stripeSvc.createCheckoutSession({
    reservationId, quote, buyer, origin, accountId, expiresAt, idempotencyKey: key,
  });

  // The session id lets an admin expire this checkout if the event stops
  // selling (openCheckouts.js); the snapshot is what fulfilment records.
  const { error } = await supabase.from('reservations')
    .update({
      attendee_data: {
        ...(reservation.attendee_data || {}),
        buyer,
        stripeSessionId: session.id,
        // The organizer account the session — and so the charge — lives on.
        // Fulfilment refuses a paid session from any other account.
        stripeAccountId: accountId,
        quote: {
          sessionId: session.id,
          accountId,
          buyerTotalCents: b.buyerTotalCents,
          currency,
          breakdown: b,
        },
      },
    })
    .eq('id', reservationId);

  if (error) {
    // Without the id nothing can expire this session later, and fulfilment
    // has no snapshot. Do not hand out a payable page we cannot account for.
    await stripeSvc.expireSession(session.id, accountId).catch((e) =>
      logger.error({ err: e.message, sessionId: session.id }, 'could not expire an unrecorded checkout'));
    throw new Error(`could not record the checkout session: ${error.message}`);
  }

  return { id: session.id, url: session.url, reused: false };
}

/**
 * The breakdown fulfilment should record for this paid session.
 *
 * The snapshot taken when the session was made is what Stripe charged, so it
 * wins over a re-quote that may have drifted since (a fee edit, a code). A
 * session whose `amount_total` matches NEITHER is logged at error level for
 * review: the buyer has paid, so tickets are still issued.
 */
function breakdownForFulfilment({ session, snapshot, requoted }) {
  const charged = session?.amount_total;
  if (snapshot && snapshot.sessionId === session?.id && snapshot.breakdown) {
    if (charged === snapshot.buyerTotalCents
      && String(session.currency || '').toLowerCase() === String(snapshot.currency || '').toLowerCase()) {
      if (requoted && requoted.buyerTotalCents !== snapshot.buyerTotalCents) {
        logger.warn({ sessionId: session.id, charged, requoted: requoted.buyerTotalCents },
          'quote changed after checkout opened; recording what was charged');
      }
      return snapshot.breakdown;
    }
  }
  if (requoted && Number.isInteger(charged) && charged !== requoted.buyerTotalCents) {
    logger.error({ sessionId: session?.id, charged, requoted: requoted.buyerTotalCents },
      'PAYMENT AMOUNT MISMATCH — Stripe charged a different total than the order records; needs review');
  }
  return requoted;
}

module.exports = {
  openSession,
  closeOpenSession,
  ensureHoldCoversSession,
  breakdownForFulfilment,
  // pure, exported for tests
  planHold,
  sessionExpiryFor,
  idempotencyKey,
  isReusable,
  SESSION_MARGIN_MIN,
  STRIPE_MIN_SESSION_MIN,
  HOLD_AT_CHECKOUT_MIN,
};
