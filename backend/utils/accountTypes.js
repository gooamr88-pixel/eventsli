/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN ACCOUNT IS FOR — and, from that, where its owner lands.
 *
 * NOT PERMISSIONS. This file decides which part of the product somebody is
 * shown; it decides nothing about what they may do. Authorization is
 * `profiles.role` and `rbacService`, and the two must never be read as one
 * thing:
 *
 *     account type   what the product is FOR this person — a preference,
 *                    chosen at sign-up, extended when they start selling
 *     role           what they are ALLOWED to do — granted server-side, never
 *                    from anything a browser sends
 *
 * The rule that keeps them apart: a value in `account_types` may change a URL
 * and may reveal a menu item. It may never be the reason a request is allowed.
 * `requireRole` does not import this file, and must not.
 *
 * THE ESCALATION THIS PREVENTS. Sign-up posts an `accountType`. If that string
 * reached `role`, anybody could POST `{"accountType":"organizer"}` and become
 * one. It reaches `account_types` instead, which buys exactly one thing — the
 * organizer dashboard is where they arrive — and the dashboard then shows them
 * the "create your organization" screen, because creating that profile is what
 * actually grants the role, server-side.
 *
 * PURE: no database, no environment. It is in the list `pureModules.test.js`
 * enforces, so it stays loadable and testable without credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The surfaces that exist. Adding one is an element here and a CHECK in SQL. */
const ACCOUNT_TYPE = Object.freeze({
  BUYER: 'buyer',
  ORGANIZER: 'organizer',
});

const ALL = Object.freeze([ACCOUNT_TYPE.BUYER, ACCOUNT_TYPE.ORGANIZER]);

/**
 * Where each surface begins.
 *
 * A buyer's home is their tickets, not the storefront: somebody who has just
 * proved who they are is looking for something that is theirs, and the
 * storefront is what they see when they have not signed in.
 *
 * Both paths are behind `proxy.ts`'s signed-in prefixes, so neither can be
 * landed on without a session.
 */
const HOME = Object.freeze({
  [ACCOUNT_TYPE.ORGANIZER]: '/organizer',
  [ACCOUNT_TYPE.BUYER]: '/account/tickets',
});

/**
 * Which surface wins when an account has more than one.
 *
 * The organizer dashboard, because it is the one with work waiting on it — an
 * organizer's tickets are two clicks away and are not usually why they signed
 * in. Order, not a special case, so a third surface slots in by position.
 */
const PRECEDENCE = Object.freeze([ACCOUNT_TYPE.ORGANIZER, ACCOUNT_TYPE.BUYER]);

/**
 * A stored value → a clean set.
 *
 * Tolerant on read and strict on write, which is the right way round for a
 * column that predates some of its rows: an old profile with `null`, a row
 * written before the backfill, or a value from a future version of the product
 * all resolve to something this code can act on instead of throwing on the
 * sign-in path.
 */
function normalise(value) {
  const list = Array.isArray(value) ? value : [];
  const known = list
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => ALL.includes(t));
  const unique = [...new Set(known)];
  // Everyone can buy a ticket, so an empty or unrecognisable set is a buyer
  // rather than an error. Landing somewhere is not optional.
  return unique.length > 0 ? unique : [ACCOUNT_TYPE.BUYER];
}

/** What to store for a `accountType` posted by a sign-up form. */
function fromSignupChoice(choice) {
  return String(choice || '').trim().toLowerCase() === ACCOUNT_TYPE.ORGANIZER
    // An organizer sign-up is a buyer too, from the first moment. They may well
    // buy a ticket to somebody else's event, and it means "both" is the
    // ordinary state of the column rather than something bolted on later.
    ? [ACCOUNT_TYPE.BUYER, ACCOUNT_TYPE.ORGANIZER]
    : [ACCOUNT_TYPE.BUYER];
}

function hasType(user, type) {
  return normalise(user?.account_types ?? user?.accountTypes).includes(type);
}

/**
 * Where this person belongs when nothing else was asked for.
 *
 * A valid `?next=` always wins and is applied by the caller — that is what
 * carries somebody back to the checkout, the event or the ticket they were
 * bounced off. This is only the answer to "and otherwise?".
 *
 * Every way in shares it: email sign-in, Google, the activation link, the
 * six-digit code, and the cross-device watch. They used to disagree — the link
 * sent organizer sign-ups to /organizer and everybody else to the storefront,
 * while sign-in and the code had no opinion at all — so the same person landed
 * somewhere different depending on which one they happened to use.
 */
function landingFor(user) {
  const types = normalise(user?.account_types ?? user?.accountTypes);
  const winner = PRECEDENCE.find((t) => types.includes(t)) || ACCOUNT_TYPE.BUYER;
  return HOME[winner];
}

module.exports = {
  ACCOUNT_TYPE, ALL, HOME, PRECEDENCE,
  normalise, fromSignupChoice, hasType, landingFor,
};
