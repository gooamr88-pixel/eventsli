const jwt = require('jsonwebtoken');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Short-lived, narrowly-scoped bearer tokens.
 *
 * No database import, no environment read at module load — the rule
 * `test/pureModules.test.js` enforces.
 *
 * WHY THESE EXIST. Several endpoints act on an object a GUEST owns, and a guest
 * has no session to prove it with. The first version simply took the object's
 * UUID as proof, which is not proof at all: a reservation id or a Stripe
 * session id travels in a URL, a browser history, a `Referer` header and an
 * analytics payload, and anyone who picks one up could release someone's seats
 * or read their tickets.
 *
 * A signed token fixes that because it cannot be produced by holding an id —
 * only by having been given one. Each is scoped to ONE object and ONE purpose,
 * and each carries a distinct `typ`, so no token can be replayed as another
 * kind. They are all signed with JWT_SECRET, and the `typ` check is the only
 * thing separating them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TYPES = Object.freeze({
  /** Read one order and its tickets. Emailed to the buyer; the QR lives behind it. */
  ORDER: 'order_access',
  /** Operate on one hold — release it, apply or remove a promo code. */
  RESERVATION: 'reservation',
  /**
   * Ask whether ONE account has finished confirming its email, and be signed in
   * when it has.
   *
   * WHAT IT IS FOR. Somebody signs up on a laptop and opens the email on their
   * phone. The phone activates the account and is signed in; the laptop sits on
   * "Check your inbox" forever, because nothing ever tells it. This is the
   * laptop's way of asking.
   *
   * NEVER EMAILED, unlike the other two. It is handed only to the browser that
   * submitted the form, which is what makes it safe to answer a question about
   * an account with: holding one means you are the tab that is waiting.
   *
   * It buys NOTHING on its own. Until the address is confirmed the answer is
   * "not yet" — and the address can only be confirmed by someone holding the
   * email. So this cannot verify an account, only notice that somebody else
   * did.
   */
  VERIFY_WATCH: 'verify_watch',
});

// Long enough to survive an event's whole sale window and a buyer coming back
// to the emailed link a month later. Short enough that a link forwarded to a
// group chat stops working before the season is out.
const ORDER_TTL_DAYS = 90;

// A hold lives 35 minutes. An hour covers it with room for a slow checkout and
// nothing more — the token is useless once the hold is gone anyway.
const RESERVATION_TTL_MINUTES = 60;

/**
 * Long enough to unlock a phone, find the email — including in spam — and tap
 * the button. Short enough that a tab forgotten overnight does not sign
 * somebody in the next morning: the activation LINK is good for 48 hours, and
 * this deliberately is not, because a window somebody is watching is a very
 * different thing from a link they are holding.
 */
const VERIFY_WATCH_TTL_MINUTES = 30;

function issueOrderToken(orderId) {
  return jwt.sign(
    { typ: TYPES.ORDER, oid: orderId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${ORDER_TTL_DAYS}d` },
  );
}

function issueReservationToken(reservationId) {
  return jwt.sign(
    { typ: TYPES.RESERVATION, rid: reservationId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${RESERVATION_TTL_MINUTES}m` },
  );
}

function issueVerifyWatchToken(userId) {
  return jwt.sign(
    { typ: TYPES.VERIFY_WATCH, uid: userId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${VERIFY_WATCH_TTL_MINUTES}m` },
  );
}

/**
 * Returns the id this token authorises, or null.
 *
 * The `typ` check is what stops a session cookie — signed with the same secret
 * — from being presented here as an order key.
 */
function readOrderToken(token) {
  const claims = verify(token);
  return claims?.typ === TYPES.ORDER && claims.oid ? claims.oid : null;
}

function readReservationToken(token) {
  const claims = verify(token);
  return claims?.typ === TYPES.RESERVATION && claims.rid ? claims.rid : null;
}

function readVerifyWatchToken(token) {
  const claims = verify(token);
  return claims?.typ === TYPES.VERIFY_WATCH && claims.uid ? claims.uid : null;
}

function verify(token) {
  try {
    return jwt.verify(String(token || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    // Expired, forged or malformed — all the same answer. Distinguishing them
    // tells a holder whether the token was ever real.
    return null;
  }
}

/**
 * Pulls a token off a request: an `Authorization: Bearer`, or an explicit
 * header, or a query parameter.
 *
 * The query parameter is accepted because an emailed link has nowhere else to
 * put it — but it is the reason these tokens are scoped to one object and one
 * verb. A URL is not a safe place for a credential, so the credential is made
 * as close to worthless as it can be while still doing its job.
 */
function fromRequest(req, headerName = 'x-access-token') {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.headers[headerName]) return String(req.headers[headerName]);
  if (req.query?.token) return String(req.query.token);
  if (req.body?.accessToken) return String(req.body.accessToken);
  return null;
}

module.exports = {
  TYPES,
  ORDER_TTL_DAYS,
  RESERVATION_TTL_MINUTES,
  VERIFY_WATCH_TTL_MINUTES,
  issueOrderToken,
  issueReservationToken,
  issueVerifyWatchToken,
  readOrderToken,
  readReservationToken,
  readVerifyWatchToken,
  fromRequest,
};
