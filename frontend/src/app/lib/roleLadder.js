/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO MAY ACT ON WHOM — mirrored from the API, stated once.
 *
 * THE API IS THE AUTHORITY. `backend/utils/roleLadder.js` holds `mayActOn`, and
 * every admin endpoint calls it before doing anything. Nothing here decides
 * whether an action is allowed; it decides whether to OFFER it, so that a
 * refusal is a control that was never shown rather than a red box after the
 * click.
 *
 * WHY IT IS ONE FILE NOW. The rule existed three times: once in the API, and
 * twice more written out by hand in the console —
 *
 *     admin/users/Users.jsx            blockedBecause()
 *     admin/organizers/AdminOrganizers.jsx   cannotActOn()
 *
 * each with its own copy of the level map. They had already drifted: one
 * defaulted an unknown role to 0 and the other to 1. That difference changes
 * nothing today, because both are below every admin level — which is exactly
 * how this kind of drift survives long enough to matter.
 *
 * The rule has changed once already. `roleLadder.js` records that the third
 * clause used to be "nobody acts on an equal", which made every super admin
 * untouchable through the API. When a rule with that history is written down
 * three times, two of the copies are a future bug.
 *
 * THE REASON IS A CODE, NOT A SENTENCE. The two screens say it differently —
 * "your own account" against "your own organizer" — and both are right for
 * where they sit. They map the code to their own words.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The ladder, identical to the API's. A test pins them together. */
export const ROLE_LEVEL = Object.freeze({
  attendee: 0, organizer: 1, admin: 2, super_admin: 3,
});

/** The roles an admin can assign, in ladder order, with what to call them. */
export const ROLES = Object.freeze([
  { value: 'attendee', label: 'Attendee' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super admin' },
]);

export function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role;
}

/** Why an action is not offered. `null` means it is. */
export const REFUSAL = Object.freeze({
  SELF: 'self',
  SUPERIOR: 'superior',
  EQUAL: 'equal',
});

/**
 * `null`, or one of `REFUSAL`.
 *
 * Unknown roles fall to 0 — the same default the API uses. Erring LOW is the
 * safe direction: it can only make this hide a control the API would have
 * allowed, never show one it will refuse.
 *
 * @param {{id: string, role: string}} actor   the signed-in admin
 * @param {{id: string, role: string}} target  the account being acted on
 */
export function actRefusal(actor, target) {
  if (!actor || !target) return null;
  if (actor.id === target.id) return REFUSAL.SELF;

  const theirs = ROLE_LEVEL[target.role] ?? 0;
  const mine = ROLE_LEVEL[actor.role] ?? 0;

  if (theirs > mine) return REFUSAL.SUPERIOR;
  // Only a super admin may act on an equal — which is what makes a compromised
  // super admin removable at all. The "last super admin" guard in the API is
  // the real protection there, and it is the API's alone.
  if (theirs === mine && actor.role !== 'super_admin') return REFUSAL.EQUAL;
  return null;
}

/**
 * The STAFF roles. Granting one is super-admin-only, separately from the ladder.
 *
 * The API's reasoning, which this mirrors: an admin who could grant `admin`
 * can create an account the other admins do not know about, and the
 * distinction between the two roles stops meaning anything.
 */
export const STAFF_ROLES = Object.freeze(['admin', 'super_admin']);

/**
 * Whether `actor` may hand out `role`.
 *
 * TWO RULES, and both are the API's (`changeRole` in admin/userController):
 *
 *   1. a staff role may be granted only by a super admin
 *   2. nobody grants a level above their own
 *
 * The second alone is NOT enough, and getting that wrong is how this control
 * ends up offering an admin the ability to make another admin — which the API
 * then refuses with a 403 after the click. Rule 1 is the one that is easy to
 * forget, because at every level except admin-granting-admin the two agree.
 */
export function canAssign(actor, role) {
  const superAdmin = Boolean(actor?.isSuperAdmin) || actor?.role === 'super_admin';
  if (STAFF_ROLES.includes(role) && !superAdmin) return false;
  return (ROLE_LEVEL[role] ?? 0) <= (ROLE_LEVEL[actor?.role] ?? 0);
}
