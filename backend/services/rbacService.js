const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * One resolved answer to "who is this and what may they do?", cached briefly.
 *
 * Every authenticated request needs the role, the ban flag, and the organizer
 * row. Fetched separately that is three round trips per request, on every
 * request; fetched once and cached for a few seconds it is close to zero. The
 * cache is deliberately short because the things it holds are exactly the
 * things that must take effect quickly — a ban that waits five minutes is a
 * ban that did not work.
 *
 * Anything that changes access MUST call `invalidate(userId)`: role changes,
 * bans, organizer creation. The TTL is a backstop for what we forget, not the
 * mechanism.
 */

const TTL_MS = 10_000;
const cache = new Map();   // userId → { at, value }

const ROLE_LEVEL = { attendee: 0, organizer: 1, admin: 2, super_admin: 3 };

async function fetchContext(userId) {
  const [{ data: profile, error: pErr }, { data: organizer }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, role, is_blocked')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('organizers')
      .select('id, display_name, country, stripe_account_id, stripe_onboarding_complete, stripe_payouts_enabled, is_banned')
      .eq('owner_user_id', userId)
      .maybeSingle(),
  ]);

  if (pErr) throw new Error(`access lookup failed: ${pErr.message}`);
  if (!profile) return null;

  const role = profile.role || 'attendee';
  const level = ROLE_LEVEL[role] ?? 0;

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role,
    level,
    isBlocked: !!profile.is_blocked,

    isOrganizer: !!organizer,
    organizerId: organizer?.id || null,
    organizerBanned: !!organizer?.is_banned,
    // Whether they can be PAID, not merely whether they connected an account.
    // A connected account that cannot receive payouts is not ready to sell.
    canReceivePayouts: !!(organizer?.stripe_onboarding_complete && organizer?.stripe_payouts_enabled),

    isAdmin: level >= ROLE_LEVEL.admin,
    isSuperAdmin: level >= ROLE_LEVEL.super_admin,
  };
}

async function getAccessContext(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const value = await fetchContext(userId);
  cache.set(userId, { at: Date.now(), value });

  // Bounded so a long-running worker cannot grow this without limit. 10s of
  // traffic is a small window, so evicting the oldest costs almost nothing.
  if (cache.size > 5000) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 1000);
    for (const [k] of oldest) cache.delete(k);
  }
  return value;
}

function invalidate(userId) {
  cache.delete(userId);
}

/**
 * NOTE for when this runs on more than one process.
 *
 * The cache is per-process, and pm2 runs the API in cluster mode — so
 * `invalidate` only clears the worker that handled the request. For up to
 * TTL_MS afterwards, another worker can still answer from a stale context.
 *
 * That is acceptable for a 10-second window on role changes, and NOT acceptable
 * for a ban. Ban therefore also revokes every session (sessionService), which
 * every worker checks against the database on each request and so cannot cache
 * around. When this moves to Redis, drop that belt-and-braces.
 */
function hasRole(access, minimum) {
  return (access?.level ?? -1) >= (ROLE_LEVEL[minimum] ?? 99);
}

module.exports = { getAccessContext, invalidate, hasRole, ROLE_LEVEL };
