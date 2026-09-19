/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE TO GO ONCE SOMEBODY IS SIGNED IN — the priority, in one place.
 *
 * Two facts arrive at every one of the six ways in, and they are not equal:
 *
 *   1. `?next=`  where this person was ACTUALLY going before they were asked to
 *                prove who they are. A checkout, an event, a ticket. It wins,
 *                always — losing it strands somebody mid-purchase on a page
 *                they did not ask for.
 *   2. the API's `next`  where an account of this TYPE belongs when nothing
 *                else was asked for. An organizer opens on the dashboard, a
 *                buyer on their tickets.
 *
 * The order used to be written out in each form, and each got it slightly
 * differently: sign-in fell through to the storefront, sign-up did the same,
 * the activation link had its own rule, and the six-digit code had none at all.
 *
 * `safeNext` REMAINS THE GATE on anything from the URL: a same-origin path or
 * nothing. `//evil.test` is an absolute URL that starts with a slash, which is
 * why one check is not enough — see LoginForm.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { safeNext } from '../(auth)/login/LoginForm';

/** The storefront. What `safeNext` returns when there is nothing usable. */
const NONE = '/';

/**
 * @param {URLSearchParams} params  this screen's query
 * @param {object} user             the API's answer, carrying its own `next`
 */
export function landingAfterAuth(params, user) {
  const asked = params?.get?.('next');
  // `safeNext` refuses an off-origin value by returning '/', which is not a
  // destination anybody asked for — so a rejected one falls through to the
  // account's own home rather than dumping them on the storefront.
  const wanted = asked ? safeNext(asked) : NONE;
  if (wanted !== NONE) return wanted;
  return user?.next || NONE;
}
