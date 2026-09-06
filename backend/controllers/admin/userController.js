const { supabase } = require('../../config/supabase');
const sessions = require('../../services/sessionService');
const rbac = require('../../services/rbacService');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { hashIp } = require('../../utils/crypto');
const logger = require('../../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BRD §19 — who someone is, and whether they may keep doing what they are doing.
 *
 * `profiles.is_blocked` and `organizers.is_banned` have existed since the base
 * schema, and until now the only way to set either was to open a SQL console
 * against production. Which means the emergency lever — a fraudulent organizer,
 * a compromised account — was a hand-written UPDATE at the worst possible
 * moment. That is how the wrong row gets updated.
 *
 * THE RULES THIS FILE ENFORCES, and none of them are cosmetic:
 *
 *   • Nobody acts on themselves. An admin who blocks their own account has
 *     locked the platform's own staff out, and an admin who could edit their own
 *     role is not really constrained by roles.
 *
 *   • Nobody acts on an equal or a superior. An admin cannot block a fellow
 *     admin, because a compromised admin account would otherwise disable every
 *     other admin and be the last one standing.
 *
 *   • Only a super admin grants staff roles. Otherwise `admin` is a role that
 *     can mint more of itself, which makes the ladder decorative.
 *
 *   • The last super admin cannot be demoted or blocked. Not "should not" —
 *     the platform becomes unadministrable, with no path back that does not
 *     involve the database directly.
 *
 * Everything here writes to admin_audit. "Who suspended this organizer, and
 * why" is the first question asked when the organizer telephones, and a log
 * that answers it is worth more than the feature.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { ROLE_LEVEL } = rbac;
const STAFF = new Set(['admin', 'super_admin']);

const fail = (res, status, error, message) => sendFail(res, { status, error, message });

/**
 * May the caller act on this user at all?
 *
 * Returns an error object rather than throwing, so the caller decides the shape
 * of the response and every check reads the same way.
 */
function mayActOn(actor, target) {
  if (actor.id === target.id) {
    return { error: 'SELF_ACTION', message: 'You cannot apply this to your own account.' };
  }
  const actorLevel = ROLE_LEVEL[actor.role] ?? 0;
  const targetLevel = ROLE_LEVEL[target.role] ?? 0;
  if (targetLevel >= actorLevel) {
    return {
      error: 'FORBIDDEN',
      message: 'You cannot act on an account at or above your own level.',
    };
  }
  return null;
}

/** How many super admins remain if this one stops being one. */
async function superAdminsBesides(userId) {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin')
    .eq('is_blocked', false)
    .neq('id', userId);
  return Number(count) || 0;
}

async function audit(req, action, targetId, payload, targetType = 'user') {
  await supabase.from('admin_audit').insert({
    actor_id: req.user.id,
    action,
    target_type: targetType,
    target_id: targetId,
    payload,
    ip_hash: hashIp(req.ip),
  });
}

// ─── GET /admin/users ───────────────────────────────────────────────────────
/**
 * Search. `q` matches email or name; `role` and `blocked` narrow it.
 *
 * No password hash, no reset token, no session id — an admin listing users is
 * not a reason to move credential material across the wire, and this response
 * ends up in browser caches and screenshots.
 */
async function list(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'email', 'role'], defaultSort: 'created_at',
    });

    let query = supabase
      .from('profiles')
      .select('id, email, full_name, role, is_blocked, created_at, '
            + 'organizers!organizers_owner_user_id_fkey ( id, display_name, country, is_banned )',
        { count: 'exact' });

    if (p.q) {
      // Escaped: a comma or a parenthesis in `q` would otherwise be read as
      // PostgREST filter syntax rather than as text being searched for.
      const safe = p.q.replace(/[,()\\]/g, ' ').trim();
      if (safe) query = query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
    }
    if (req.query.role && ROLE_LEVEL[req.query.role] !== undefined) {
      query = query.eq('role', req.query.role);
    }
    if (req.query.blocked === 'true') query = query.eq('is_blocked', true);
    if (req.query.blocked === 'false') query = query.eq('is_blocked', false);

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map(shapeUser), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

// ─── GET /admin/users/:userId ───────────────────────────────────────────────
async function detail(req, res, next) {
  try {
    const { data: user } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, role, is_blocked, created_at, '
            + 'organizers!organizers_owner_user_id_fkey ( id, display_name, country, is_banned, '
            + 'stripe_onboarding_complete, stripe_payouts_enabled, created_at )')
      .eq('id', req.params.userId)
      .maybeSingle();

    if (!user) return fail(res, 404, 'NOT_FOUND', 'No such user.');

    // Live sessions, so an admin can see whether a blocked account is still
    // being used somewhere before they go looking for the reason.
    const { count: liveSessions } = await supabase
      .from('sessions')
      .select('jti', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());

    const organizer = Array.isArray(user.organizers) ? user.organizers[0] : user.organizers;
    let events = null;
    if (organizer) {
      const { count } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('organizer_id', organizer.id)
        .eq('status', 'published');
      events = { published: Number(count) || 0 };
    }

    return sendOk(res, {
      ...shapeUser(user),
      phone: user.phone,
      liveSessions: Number(liveSessions) || 0,
      events,
    });
  } catch (err) { return next(err); }
}

// ─── PATCH /admin/users/:userId/role ────────────────────────────────────────
/**
 * Promote or demote.
 *
 * Granting `admin` or `super_admin` is super-admin-only. An `admin` who could
 * grant `admin` can create an account the other admins do not know about, and
 * the distinction between the two roles stops meaning anything.
 */
async function changeRole(req, res, next) {
  try {
    const role = String(req.body.role);
    const { data: target } = await supabase
      .from('profiles').select('id, email, role').eq('id', req.params.userId).maybeSingle();
    if (!target) return fail(res, 404, 'NOT_FOUND', 'No such user.');

    const denied = mayActOn(req.user, target);
    if (denied) return fail(res, denied.error === 'SELF_ACTION' ? 409 : 403, denied.error, denied.message);

    if (STAFF.has(role) && !req.user.access.isSuperAdmin) {
      return fail(res, 403, 'FORBIDDEN', 'Only a super admin can grant a staff role.');
    }
    if ((ROLE_LEVEL[role] ?? 0) > (ROLE_LEVEL[req.user.role] ?? 0)) {
      return fail(res, 403, 'FORBIDDEN', 'You cannot grant a role above your own.');
    }
    if (target.role === 'super_admin' && role !== 'super_admin'
        && (await superAdminsBesides(target.id)) === 0) {
      return fail(res, 409, 'LAST_SUPER_ADMIN',
        'This is the only super admin left. Promote someone else first.');
    }

    // Demoting an organizer does NOT delete their organizer record. Their past
    // events, orders and invoices still reference it, and the money has to stay
    // attributable. Use the ban for "stop them selling".
    const { data, error } = await supabase
      .from('profiles').update({ role }).eq('id', target.id)
      .select('id, email, full_name, role, is_blocked, created_at').single();
    if (error) throw new Error(error.message);

    rbac.invalidate(target.id);
    await audit(req, 'user.role_changed', target.id, { before: target.role, after: role });
    logger.warn({ userId: target.id, from: target.role, to: role, by: req.user.id },
      'user role changed');

    return sendOk(res, shapeUser(data));
  } catch (err) { return next(err); }
}

// ─── POST /admin/users/:userId/block ────────────────────────────────────────
/**
 * Blocking is immediate, and that word has to be true across every pm2 worker.
 *
 * `rbacService` caches the access context for ten seconds PER PROCESS, so
 * invalidating it here only clears the worker that handled this request. For up
 * to ten seconds another worker would still let the blocked account through.
 * So the block also revokes every session, which is checked against the
 * database on each request and cannot be cached around.
 */
async function block(req, res, next) {
  try {
    const { data: target } = await supabase
      .from('profiles').select('id, email, role, is_blocked').eq('id', req.params.userId)
      .maybeSingle();
    if (!target) return fail(res, 404, 'NOT_FOUND', 'No such user.');

    const denied = mayActOn(req.user, target);
    if (denied) return fail(res, denied.error === 'SELF_ACTION' ? 409 : 403, denied.error, denied.message);

    if (target.role === 'super_admin' && (await superAdminsBesides(target.id)) === 0) {
      return fail(res, 409, 'LAST_SUPER_ADMIN',
        'This is the only super admin left. Blocking it locks everyone out.');
    }

    const { error } = await supabase
      .from('profiles').update({ is_blocked: true }).eq('id', target.id);
    if (error) throw new Error(error.message);

    rbac.invalidate(target.id);
    const revoked = await sessions.revokeAllForUser(target.id, 'account_blocked');

    await audit(req, 'user.blocked', target.id,
      { reason: req.body.reason || null, sessionsRevoked: revoked ?? null });
    logger.warn({ userId: target.id, by: req.user.id, reason: req.body.reason }, 'user blocked');

    return sendOk(res, { id: target.id, isBlocked: true });
  } catch (err) { return next(err); }
}

// ─── POST /admin/users/:userId/unblock ──────────────────────────────────────
async function unblock(req, res, next) {
  try {
    const { data: target } = await supabase
      .from('profiles').select('id, email, role').eq('id', req.params.userId).maybeSingle();
    if (!target) return fail(res, 404, 'NOT_FOUND', 'No such user.');

    const denied = mayActOn(req.user, target);
    if (denied) return fail(res, denied.error === 'SELF_ACTION' ? 409 : 403, denied.error, denied.message);

    const { error } = await supabase
      .from('profiles').update({ is_blocked: false }).eq('id', target.id);
    if (error) throw new Error(error.message);

    // Sessions are NOT restored. They were revoked, and a revoked session is
    // dead — the user signs in again, which is also the moment we learn they
    // still hold the password.
    rbac.invalidate(target.id);
    await audit(req, 'user.unblocked', target.id, { reason: req.body.reason || null });
    logger.warn({ userId: target.id, by: req.user.id }, 'user unblocked');

    return sendOk(res, { id: target.id, isBlocked: false });
  } catch (err) { return next(err); }
}

// ─── POST /admin/organizers/:organizerId/ban ────────────────────────────────
/**
 * Stops an organizer selling, without touching their account.
 *
 * Separate from blocking the user on purpose. A blocked user cannot sign in at
 * all; a banned organizer signs in, sees their events and their outstanding
 * commission invoice, and cannot put anything new on sale or change what is
 * listed. That distinction matters because the usual reason to ban is money
 * owed, and an organizer who cannot see the invoice cannot pay it.
 *
 * Published events are deliberately NOT suspended here. Doing that silently
 * would pull events that have already sold tickets, leaving buyers holding
 * valid QR codes for something no longer listed. The response reports how many
 * are live so the admin can suspend them explicitly if that is what they mean.
 */
async function banOrganizer(req, res, next) {
  try {
    const { data: org } = await supabase
      .from('organizers')
      .select('id, display_name, is_banned, owner_user_id, profiles!organizers_owner_user_id_fkey ( id, role )')
      .eq('id', req.params.organizerId)
      .maybeSingle();
    if (!org) return fail(res, 404, 'NOT_FOUND', 'No such organizer.');

    const owner = Array.isArray(org.profiles) ? org.profiles[0] : org.profiles;
    const denied = mayActOn(req.user, { id: org.owner_user_id, role: owner?.role || 'organizer' });
    if (denied) return fail(res, denied.error === 'SELF_ACTION' ? 409 : 403, denied.error, denied.message);

    const { error } = await supabase
      .from('organizers').update({ is_banned: true }).eq('id', org.id);
    if (error) throw new Error(error.message);

    rbac.invalidate(org.owner_user_id);
    // The ban is read from the cached access context, which is per-process and
    // ten seconds stale. Revoking the sessions forces a fresh context on the
    // next request, on every worker.
    await sessions.revokeAllForUser(org.owner_user_id, 'organizer_banned');

    const { count: live } = await supabase
      .from('events').select('id', { count: 'exact', head: true })
      .eq('organizer_id', org.id).eq('status', 'published');

    await audit(req, 'organizer.banned', org.id,
      { reason: req.body.reason, publishedEvents: Number(live) || 0 }, 'organizer');
    logger.warn({ organizerId: org.id, by: req.user.id, reason: req.body.reason },
      'organizer banned');

    return sendOk(res, {
      id: org.id,
      isBanned: true,
      publishedEvents: Number(live) || 0,
      note: live
        ? `${live} event${live === 1 ? ' is' : 's are'} still published and selling. `
          + 'Suspend them separately if they should come down.'
        : null,
    });
  } catch (err) { return next(err); }
}

// ─── POST /admin/organizers/:organizerId/unban ──────────────────────────────
async function unbanOrganizer(req, res, next) {
  try {
    const { data: org } = await supabase
      .from('organizers').select('id, owner_user_id').eq('id', req.params.organizerId).maybeSingle();
    if (!org) return fail(res, 404, 'NOT_FOUND', 'No such organizer.');

    const { error } = await supabase
      .from('organizers').update({ is_banned: false }).eq('id', org.id);
    if (error) throw new Error(error.message);

    rbac.invalidate(org.owner_user_id);
    await audit(req, 'organizer.unbanned', org.id, { reason: req.body.reason || null }, 'organizer');
    logger.warn({ organizerId: org.id, by: req.user.id }, 'organizer unbanned');

    return sendOk(res, { id: org.id, isBanned: false });
  } catch (err) { return next(err); }
}

function shapeUser(u) {
  const organizer = Array.isArray(u.organizers) ? u.organizers[0] : u.organizers;
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isBlocked: !!u.is_blocked,
    createdAt: u.created_at,
    organizer: organizer ? {
      id: organizer.id,
      displayName: organizer.display_name,
      country: organizer.country,
      isBanned: !!organizer.is_banned,
      canReceivePayouts: !!(organizer.stripe_onboarding_complete
                         && organizer.stripe_payouts_enabled),
    } : null,
  };
}

module.exports = {
  list, detail, changeRole, block, unblock, banOrganizer, unbanOrganizer,
};
