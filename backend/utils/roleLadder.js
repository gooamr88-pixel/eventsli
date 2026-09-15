/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Who may act on whom (BRD §19).
 *
 *   • Nobody acts on themselves.
 *   • Nobody acts on a superior.
 *   • Only a SUPER ADMIN acts on an equal — another super admin.
 *
 * The third rule used to be "nobody acts on an equal", which made every super
 * admin untouchable through the API: a compromised one could only be removed
 * with SQL, and the "last super admin" guard in userController could never be
 * reached. Now that guard is the real protection — a super admin can demote or
 * block another, never the last one standing.
 *
 * An admin still cannot act on another admin: otherwise one compromised admin
 * account disables every other and is the last one left.
 *
 * Pure, so it is testable without a database.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ROLE_LEVEL = Object.freeze({ attendee: 0, organizer: 1, admin: 2, super_admin: 3 });

/** An error object, or null when the actor may act on the target. */
function mayActOn(actor, target) {
  if (actor.id === target.id) {
    return { error: 'SELF_ACTION', message: 'You cannot apply this to your own account.' };
  }
  const actorLevel = ROLE_LEVEL[actor.role] ?? 0;
  const targetLevel = ROLE_LEVEL[target.role] ?? 0;
  if (targetLevel > actorLevel) {
    return { error: 'FORBIDDEN', message: 'You cannot act on an account above your own level.' };
  }
  if (targetLevel === actorLevel && actor.role !== 'super_admin') {
    return { error: 'FORBIDDEN', message: 'You cannot act on an account at your own level.' };
  }
  return null;
}

module.exports = { ROLE_LEVEL, mayActOn };
