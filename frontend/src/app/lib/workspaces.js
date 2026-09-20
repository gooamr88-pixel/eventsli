/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH PART OF THE PRODUCT SOMEBODY IS IN — the concept the client was missing.
 *
 * The API has modelled this correctly from the start. `backend/utils/
 * accountTypes.js` keeps two facts apart and argues at length why:
 *
 *     account type   what the product is FOR this person — buyer, organizer, or
 *                    both. A preference, chosen at sign-up.
 *     role           what they are ALLOWED to do — granted server-side.
 *
 * `/auth/me` ships both, on every request: `accountTypes` beside `role`,
 * `isOrganizer` and `isAdmin`. Until now THE CLIENT READ ONLY THE SECOND SET.
 * `accountTypes` appeared in exactly one comment and in no decision anywhere.
 *
 * That single omission is behind most of what reads as incoherence:
 *
 *   · A buyer was rendered as "an organizer who has not set up yet", because
 *     `!isOrganizer` was the only thing anybody asked. So the masthead's one
 *     promoted button said "Create event" to somebody who came to buy a ticket,
 *     and pointed at /organizer — which is the become-an-organizer form.
 *   · An organizer-type account whose profile does not exist yet has
 *     `isOrganizer: false`, so the login landing (which does read the types)
 *     sent them to /organizer while every piece of chrome around them treated
 *     them as a buyer.
 *   · An account that is both had no way to say which one it was being right
 *     now, because there was nothing for it to say that about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A WORKSPACE IS NOT A PERMISSION, and this file must never become one.
 *
 * It answers "which surface is this person in, and which others could they
 * enter" — for a sidebar, a switcher and a landing path. Every route underneath
 * still takes its access from the API, which re-checks role and ownership on
 * every request. A workspace listed here that the API refuses is a dead link; a
 * workspace missing from here is a menu item somebody cannot find. Neither is
 * an open door, and that asymmetry is what makes it safe to decide this on the
 * client at all.
 *
 * The one place the distinction shows: ADMIN IS ROLE-DERIVED, while buyer and
 * organizer are type-derived. That is not an inconsistency, it is the same rule
 * the API applies — nobody chooses to be staff at sign-up, and `account_types`
 * has no 'admin' value to choose.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The three surfaces. Buyer and organizer mirror the API's `ACCOUNT_TYPE`. */
export const WORKSPACE = Object.freeze({
  BUYER: 'buyer',
  ORGANIZER: 'organizer',
  ADMIN: 'admin',
});

/**
 * Where each one begins, and these are the paths the API lands people on.
 *
 * `backend/utils/accountTypes.js` holds `HOME` for the two it knows about and
 * is the authority for them; a test there asserts every one sits behind a
 * prefix `proxy.ts` guards. This table repeats them because the switcher and
 * the shells need them client-side, and a drift between the two would send
 * somebody to a different place depending on whether they had just signed in or
 * just switched.
 */
export const WORKSPACE_HOME = Object.freeze({
  [WORKSPACE.BUYER]: '/account',
  [WORKSPACE.ORGANIZER]: '/organizer',
  [WORKSPACE.ADMIN]: '/admin/overview',
});

/** What to call each one, in the sidebar heading and the switcher. */
export const WORKSPACE_LABEL = Object.freeze({
  [WORKSPACE.BUYER]: 'Tickets',
  [WORKSPACE.ORGANIZER]: 'Organizer',
  [WORKSPACE.ADMIN]: 'Admin',
});

/** The one line under each name in the switcher: what this surface is for. */
export const WORKSPACE_BLURB = Object.freeze({
  [WORKSPACE.BUYER]: 'Your tickets, orders and saved events',
  [WORKSPACE.ORGANIZER]: 'Your events, sales and attendees',
  [WORKSPACE.ADMIN]: 'Platform operations',
});

export const WORKSPACE_ICON = Object.freeze({
  [WORKSPACE.BUYER]: 'ticket',
  [WORKSPACE.ORGANIZER]: 'briefcase',
  [WORKSPACE.ADMIN]: 'shield',
});

/**
 * The URL prefix each workspace owns, longest first.
 *
 * Longest-first is not needed by today's three — they share no prefix — and is
 * written that way anyway, because the day one surface nests inside another's
 * path a shortest-first match silently claims the wrong one.
 */
const PREFIXES = Object.freeze([
  [WORKSPACE.ADMIN, '/admin'],
  [WORKSPACE.ORGANIZER, '/organizer'],
  [WORKSPACE.BUYER, '/account'],
]);

/**
 * WHERE AM I — answered from the URL alone.
 *
 * From the URL, not from state, for the reason `resolveNav` resolves "current"
 * from the pathname: a variable somebody has to remember to keep in step is a
 * variable that will be wrong on whichever route nobody thought about. A public
 * page belongs to no workspace and returns null, which is right — the
 * storefront is not a workspace, it is the shop.
 */
export function workspaceOf(pathname) {
  const path = String(pathname || '');
  return PREFIXES.find(([, prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[0] || null;
}

/**
 * WHICH WORKSPACES THIS ACCOUNT MAY ENTER, in the order to offer them.
 *
 * BUYER IS ALWAYS PRESENT. Everybody can buy a ticket, and the API says the
 * same thing by normalising an empty or unrecognisable `account_types` to
 * `['buyer']` rather than to an error. It is also what stops this ever
 * returning an empty list, so there is always somewhere to be.
 *
 * ORGANIZER IS EITHER FACT, and both clauses earn their place:
 *
 *   `accountTypes` has it   they said at sign-up that they came to sell. Their
 *                           profile may not exist yet — that is the state the
 *                           dashboard's setup screen is for, and hiding the
 *                           workspace would hide the way to it.
 *   `isOrganizer`           the role is granted, so a profile does exist. An
 *                           account whose type column predates the column still
 *                           gets the workspace it has been using all along.
 *
 * Either alone strands somebody: the first without the second hides the
 * dashboard from every organizer created before `account_types` existed, and
 * the second without the first hides the setup screen from every organizer
 * sign-up that has not finished it.
 *
 * ADMIN IS THE ROLE, never a type. `isAdmin` comes from `/auth/me`, which reads
 * it server-side.
 *
 * @param {object|null} user  the `/auth/me` answer
 * @returns {string[]} workspaces, in the order to offer them
 */
export function workspacesFor(user) {
  if (!user) return [];

  const types = Array.isArray(user.accountTypes) ? user.accountTypes : [];
  const list = [WORKSPACE.BUYER];

  if (types.includes(WORKSPACE.ORGANIZER) || user.isOrganizer) list.push(WORKSPACE.ORGANIZER);
  if (user.isAdmin) list.push(WORKSPACE.ADMIN);

  return list;
}

/** Whether this account may enter a given workspace at all. */
export function hasWorkspace(user, workspace) {
  return workspacesFor(user).includes(workspace);
}

/**
 * Where this account belongs when nothing else was asked for.
 *
 * THE SAME PRECEDENCE THE API USES, and it has to be: `landingFor` in
 * `accountTypes.js` prefers the organizer dashboard "because it is the one with
 * work waiting on it". Admin does not beat it, for the reason `navCta` had
 * already worked out — somebody who is both is far more often coming back to
 * their own events than to the console, and the console is one click away from
 * either side.
 *
 * The API's `user.next` stays the authority on the sign-in path itself. This is
 * the client's answer for the moments when there is no fresh API response to
 * hand: a switch, or a signed-in visitor who typed /login.
 */
export function defaultWorkspace(user) {
  const mine = workspacesFor(user);
  for (const candidate of [WORKSPACE.ORGANIZER, WORKSPACE.ADMIN, WORKSPACE.BUYER]) {
    if (mine.includes(candidate)) return candidate;
  }
  return WORKSPACE.BUYER;
}

/** `defaultWorkspace`, as the path to send somebody to. */
export function defaultLanding(user) {
  return WORKSPACE_HOME[defaultWorkspace(user)];
}

/**
 * THE SWITCHER'S ROWS — the other workspaces, never this one.
 *
 * A switcher that lists the workspace you are already in has to then style one
 * row as inert and explain why, which is three states for a control that needs
 * two. The current one is named in the sidebar's own heading, above this,
 * which is where "where am I" belongs.
 */
export function switchTargets(user, pathname) {
  const here = workspaceOf(pathname);
  return workspacesFor(user)
    .filter((w) => w !== here)
    .map((w) => ({
      key: w,
      href: WORKSPACE_HOME[w],
      label: WORKSPACE_LABEL[w],
      blurb: WORKSPACE_BLURB[w],
      icon: WORKSPACE_ICON[w],
    }));
}
