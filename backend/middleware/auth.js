const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const sessions = require('../services/sessionService');
const { getAccessContext, hasRole } = require('../services/rbacService');
const { sendFail } = require('../utils/responseEnvelope');

/**
 * Where the token comes from: the httpOnly cookie first, then a Bearer header.
 *
 * The cookie is the browser's path and is unreadable to JavaScript, so an XSS
 * cannot exfiltrate it. The header exists for the scanner app and any future
 * non-browser client, which have no cookie jar.
 */
function extractToken(req) {
  if (req.cookies?.[sessions.COOKIE_NAME]) return req.cookies[sessions.COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Verify, then check the session is live, then resolve access — in that order.
 *
 * Each step is cheaper than the next and rejects more traffic, so a flood of
 * forged tokens is turned away by signature verification without ever reaching
 * the database.
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return sendFail(res, {
      status: 401, error: 'UNAUTHENTICATED',
      message: 'You need to be signed in to do that.',
    });
  }

  let decoded;
  try {
    // The algorithm is pinned. Without this, a token with `alg: none` — or one
    // signed with a public key the server also holds — can be accepted.
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return sendFail(res, {
      status: 401, error: 'INVALID_TOKEN',
      message: 'Your session is invalid or has expired. Please sign in again.',
    });
  }

  if (!(await sessions.isValid(decoded))) {
    sessions.clearCookie(res);
    return sendFail(res, {
      status: 401, error: 'SESSION_REVOKED',
      message: 'This session has ended. Please sign in again.',
    });
  }

  const access = await getAccessContext(decoded.sub);
  if (!access) {
    // The token verifies but the account is gone.
    sessions.clearCookie(res);
    return sendFail(res, {
      status: 401, error: 'UNAUTHENTICATED',
      message: 'This account no longer exists.',
    });
  }
  if (access.isBlocked) {
    return sendFail(res, {
      status: 403, error: 'ACCOUNT_BANNED',
      message: 'This account has been suspended. Contact support if you think that is a mistake.',
    });
  }

  req.user = {
    id: access.userId,
    email: access.email,
    role: access.role,
    jti: decoded.jti,
    access,
    // Present only on a token minted by an admin impersonating an organizer, so
    // the UI can show a banner and offer a way back.
    impersonatorId: decoded.imp || null,
  };

  sessions.touch(decoded.jti);   // fire and forget
  return next();
}

/**
 * Populates req.user when a valid session exists, and simply continues when it
 * does not. For endpoints that behave differently for a signed-in visitor —
 * a public event page that pre-fills the buyer's details, for instance.
 *
 * Applies the SAME revocation check as requireAuth. Skipping it here would mean
 * a banned or logged-out user is still treated as authenticated on every
 * optional-auth route until their token expires naturally.
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessions.isValid(decoded)) {
      const access = await getAccessContext(decoded.sub);
      if (access && !access.isBlocked) {
        req.user = {
          id: access.userId, email: access.email, role: access.role,
          jti: decoded.jti, access, impersonatorId: decoded.imp || null,
        };
      }
    }
  } catch {
    // An invalid token on an optional route is simply an anonymous visitor.
  }
  return next();
}

/** `requireRole('admin')` — the level ladder is attendee < organizer < admin < super_admin. */
function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) {
      return sendFail(res, { status: 401, error: 'UNAUTHENTICATED', message: 'Sign in first.' });
    }
    if (!hasRole(req.user.access, minimum)) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN',
        message: 'You do not have access to this area.',
      });
    }
    return next();
  };
}

/**
 * A banned organizer stops selling.
 *
 * `organizers.is_banned` existed from the base schema and `rbacService` has
 * been reporting it as `organizerBanned` since — and nothing, anywhere, read
 * it. An admin could set the flag and the organizer would carry on creating
 * events, editing maps and taking money, because no code path asked.
 *
 * Reads stay open on purpose. A banned organizer still needs to see their
 * events, their sales and above all the commission invoice they owe us; taking
 * that away turns a suspension into a support ticket. It is the writes that
 * stop — nothing new goes on sale, and nothing already listed can be changed.
 *
 * Admins pass through: they legitimately act on a banned organizer's events,
 * which is often the entire reason the ban happened.
 */
function requireActiveOrganizer(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.user?.access?.isAdmin) return next();

  if (req.user?.access?.organizerBanned) {
    return sendFail(res, {
      status: 403, error: 'ORGANIZER_BANNED',
      message: 'This organizer account is suspended. Existing tickets stay valid; '
             + 'contact support to appeal.',
    });
  }
  return next();
}

/**
 * The event in :eventId must belong to the caller's organizer.
 *
 * This exists because the API uses the service-role Supabase client, which
 * bypasses row-level security entirely — so ownership is not enforced by the
 * database on our behalf. Every route under /events/:eventId needs this, and
 * relying on each controller to remember is how one of them eventually does not.
 */
async function verifyEventOwner(req, res, next) {
  const { eventId } = req.params;
  if (!eventId) return next();

  // An admin acting through the admin panel legitimately reaches any event.
  if (req.user?.access?.isAdmin) return next();

  const { data: event, error } = await supabase
    .from('events')
    .select('id, organizer_id')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    return sendFail(res, {
      status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.',
    });
  }

  if (event.organizer_id !== req.user?.access?.organizerId) {
    // 404, not 403: a 403 confirms the event exists, which lets someone probe
    // for valid ids. Nothing they are allowed to see distinguishes the two.
    return sendFail(res, {
      status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.',
    });
  }

  req.event = event;
  return next();
}

module.exports = {
  requireAuth, optionalAuth, requireRole, requireActiveOrganizer, verifyEventOwner, extractToken,
};
