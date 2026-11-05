/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Who may transfer a ticket (BRD §10) — the decision alone, pure, so every
 * case is unit-tested without a database (test/ticketTransfer.test.js).
 *
 * A transfer is one-way and once-only: get this wrong and the person who paid
 * loses the ticket for good. So it fails CLOSED — one of these must positively
 * hold, and anything missing or mismatched is a no.
 *
 *   ACCOUNT  the order was bought signed in, and this is that account.
 *
 *   GUEST    the order was bought as a guest, and the caller proves they
 *            control the address it went to, in one of two ways:
 *              · they are signed in, and their account's email IS that
 *                address. Login refuses an unverified account
 *                (EMAIL_NOT_VERIFIED), so the address is proven, not typed;
 *              · they hold the signed order token from the confirmation email
 *                (accessTokens.issueOrderToken), for THIS order.
 *
 * WHAT WAS WRONG (fixed 2026-11-05). The guest proof was a `proofEmail` field
 * the caller could fill in — so knowing the buyer's address was enough. The
 * event's organizer sees every ticket id and buyer email on the door list, so
 * they, or anyone shown that list, could sign in with any account and move a
 * guest's ticket to themselves. A typed address proves nothing; an inbox does.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param {object} order   { id, user_id, guest_email } of the ticket's order
 * @param {object} caller  { userId, email } of the signed-in account, and
 *                         `tokenOrderId`: the order id a presented, verified
 *                         order token carries (null when none or invalid)
 * @returns {'account'|'guest-email'|'guest-token'|null}  how it was proven, or null
 */
function transferProof(order, caller) {
  if (!order || !caller) return null;
  const buyerUserId = order.user_id || null;
  const guestEmail = normal(order.guest_email);

  if (buyerUserId) {
    return caller.userId && caller.userId === buyerUserId ? 'account' : null;
  }

  // A guest purchase from here on: there is no account to match.
  if (guestEmail && normal(caller.email) === guestEmail) return 'guest-email';
  if (order.id && caller.tokenOrderId && caller.tokenOrderId === order.id) return 'guest-token';
  return null;
}

function normal(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

module.exports = { transferProof };
