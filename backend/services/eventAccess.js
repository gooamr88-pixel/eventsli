const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Private events, behind a password (owner, 2026-11-22).
 *
 * The same two rules as private tables (tableAccessService.js), one level up:
 *
 *   1. A private event is LEFT OUT of every listing, not flagged. Every public
 *      query of `events` adds `.eq('is_private', false)` — see `listed()`.
 *
 *   2. The password is checked HERE, against a stretched hash. Unlocking
 *      returns a signed token for one event; the browser keeps it as an
 *      httpOnly cookie, so the server-rendered page can read it too (the API
 *      and the site share eventsli.com — docs/DEPLOY.md).
 *
 * The token carries `access_password_set_at`. Changing the password changes
 * that, and every earlier unlock stops working on its next request.
 *
 * The event's own organizer and Eventsli admins are never asked: they see
 * their event with their session, exactly as a guest with the password would.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TOKEN_TYPE = 'event_access';
// A guest who unlocks in the evening and buys the next morning should not be
// asked again; a link-and-password pasted somewhere stops working within days
// once the organizer changes the password.
const ACCESS_TTL_HOURS = 24 * 7;
const HEADER = 'x-event-access';
/**
 * THE LENGTH RULE IS THE ORGANIZER'S (owner, 2026-11-22): they choose the
 * shortest and longest their password may be, anywhere inside the platform's
 * hard bounds. Without a rule of their own, 4 to 100 applies.
 */
const HARD_MIN = 1;
const HARD_MAX = 100;
const DEFAULT_RULE = Object.freeze({ min: 4, max: 100 });
// Kept for callers reading the old names.
const PASSWORD_MIN = DEFAULT_RULE.min;
const PASSWORD_MAX = HARD_MAX;

/** The length rule in force for an event row. */
function ruleOf(event) {
  return {
    min: event?.access_password_min ?? DEFAULT_RULE.min,
    max: event?.access_password_max ?? DEFAULT_RULE.max,
  };
}

/** Is `{ min, max }` a rule an organizer may set? */
function validRule(rule) {
  const { min, max } = rule || {};
  return Number.isInteger(min) && Number.isInteger(max)
    && min >= HARD_MIN && max <= HARD_MAX && min <= max;
}

const fits = (value, rule) => value.length >= rule.min && value.length <= rule.max;

/** One cookie per event, so unlocking a second event does not lock the first. */
function cookieName(eventId) {
  return `eventsli_ea_${String(eventId).replace(/[^a-f0-9]/gi, '')}`;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax`, as the session is: it has to arrive on the top-level navigation
    // to the event page from a link in a message.
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_HOURS * 3600 * 1000,
  };
}

/** Add the "public listings only" condition to a query of `events`. */
function listed(query, column = 'is_private') {
  return query.eq(column, false);
}

function versionOf(event) {
  const t = Date.parse(event.access_password_set_at || '');
  return Number.isFinite(t) ? t : 0;
}

function issueToken(event) {
  return jwt.sign(
    { typ: TOKEN_TYPE, eventId: event.id, v: versionOf(event) },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${ACCESS_TTL_HOURS}h` },
  );
}

function tokenValid(raw, event) {
  if (!raw) return false;
  try {
    const claims = jwt.verify(String(raw), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // `typ` stops a session or table token being replayed as an event key —
    // all three are signed with the same secret.
    return claims.typ === TOKEN_TYPE && claims.eventId === event.id && claims.v === versionOf(event);
  } catch {
    return false;
  }
}

/**
 * May this request see this event?
 *
 * `event` must carry `id, is_private, access_password_set_at, organizer_id`.
 * Public events are always yes. A private one is yes for a valid token (cookie
 * or `x-event-access` header), for its organizer, and for an admin.
 */
function canView(req, event) {
  if (!event || event.is_private !== true) return true;
  const access = req?.user?.access;
  if (access?.isAdmin) return true;
  if (access?.organizerId && access.organizerId === event.organizer_id) return true;
  const raw = req?.cookies?.[cookieName(event.id)] || req?.get?.(HEADER);
  return tokenValid(raw, event);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `canView`, plus what only the database knows about a SIGNED-IN visitor
 * (owner, 2026-11-22: "all if I have session or permission, or ask again").
 * The places that gate an event call this one.
 *
 * A session alone is not permission — every account would see every private
 * event. A session WITH permission is let in without the password:
 *
 *   · the organizer and admins (`canView`, as before);
 *   · the event's door team (`event_staff`, not revoked);
 *   · a ticket holder: a paid order on this account, or — only when the
 *     account's email is VERIFIED — an order or ticket sent to that email. An
 *     unverified address could be anyone's, so it proves nothing;
 *   · an account that unlocked this event before (`event_access_grants`),
 *     on any device, while the password has not changed since.
 *
 * Anyone else is asked for the password. Any read error answers no: a private
 * event fails closed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function allowed(req, event) {
  if (canView(req, event)) return true;
  const userId = req?.user?.id;
  if (!userId || !event?.id) return false;
  try {
    const one = (q) => q.limit(1).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return (data || []).length > 0;
    });
    const [grant, staff, ordered, profile] = await Promise.all([
      supabase.from('event_access_grants').select('password_set_at')
        .eq('user_id', userId).eq('event_id', event.id).maybeSingle(),
      one(supabase.from('event_staff').select('id').eq('event_id', event.id).eq('user_id', userId).is('revoked_at', null)),
      one(supabase.from('orders').select('id').eq('event_id', event.id).eq('user_id', userId).eq('status', 'paid')),
      supabase.from('profiles').select('email, email_verified_at').eq('id', userId).maybeSingle(),
    ]);
    if (grant.error) throw new Error(grant.error.message);
    if (grant.data && versionOf({ access_password_set_at: grant.data.password_set_at }) === versionOf(event)) return true;
    if (staff || ordered) return true;

    const email = String(profile.data?.email || '').trim().toLowerCase();
    if (!email || !profile.data?.email_verified_at) return false;
    const [byGuestEmail, byTicket] = await Promise.all([
      one(supabase.from('orders').select('id').eq('event_id', event.id).eq('status', 'paid').eq('guest_email', email)),
      one(supabase.from('tickets').select('id').eq('event_id', event.id).neq('status', 'void').eq('attendee_email', email)),
    ]);
    return byGuestEmail || byTicket;
  } catch (err) {
    require('../utils/logger').warn({ err: err.message, eventId: event.id }, 'private event: permission check failed, asking for the password');
    return false;
  }
}

/**
 * An unlock made while signed in is remembered on the account, so the same
 * person is not asked again on another device. Never fatal: the cookie has
 * already been set, and this is a convenience on top of it.
 */
async function rememberUnlock(req, event) {
  const userId = req?.user?.id;
  if (!userId || !event?.id) return;
  const { error } = await supabase.from('event_access_grants').upsert(
    { user_id: userId, event_id: event.id, password_set_at: event.access_password_set_at || null },
    { onConflict: 'user_id,event_id' },
  );
  if (error) require('../utils/logger').warn({ err: error.message, eventId: event.id }, 'private event: unlock not remembered on the account');
}

/** The columns `canView` needs — add these to any event read that gates on it. */
const ACCESS_COLUMNS = 'is_private, access_password_set_at, organizer_id, access_password_min, access_password_max, locked_preview, locked_reveal';

/**
 * WHAT THE ORGANIZER LETS A LOCKED VISITOR READ (2026-11-22, the owner: "blur
 * all details and images of a private event until it is unlocked — and the
 * organizer decides"). Migration 20261209090000.
 *
 * Anything not revealed is NEVER SENT. The blurred page a visitor sees is drawn
 * over placeholders, and the cover over a tiny copy made here (lockedCover),
 * so there is nothing under the blur to recover with a browser's inspector.
 */
const REVEAL_KEYS = Object.freeze(['title', 'organizer', 'cover', 'date', 'city']);
const DEFAULT_REVEAL = Object.freeze(['title', 'organizer']);
const PREVIEWS = Object.freeze(['blur', 'card']);

/** A reveal list as stored: known keys, once each, in a fixed order. */
function cleanReveal(list) {
  const wanted = new Set(Array.isArray(list) ? list : DEFAULT_REVEAL);
  return REVEAL_KEYS.filter((k) => wanted.has(k));
}

/** Everything a teaser can need, for a locked answer whose row lacks some of it. */
const TEASER_COLUMNS = `id, slug, title, cover_url, logo_url, starts_at, timezone, city, ${'locked_preview, locked_reveal, access_password_min, access_password_max'}, organizers ( display_name )`;

/**
 * What a locked page may show: enough for the person who was sent the link to
 * know they are in the right place, and nothing they would need the password
 * for — no date, no venue, no prices, no tickets.
 */
function lockedTeaser(event) {
  const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers;
  const reveal = new Set(cleanReveal(event.locked_reveal));
  const show = (key, value) => (reveal.has(key) ? value ?? null : null);
  return {
    slug: event.slug,
    // How the page looks before the password, and what it may say (2026-11-22).
    preview: PREVIEWS.includes(event.locked_preview) ? event.locked_preview : 'blur',
    reveal: [...reveal],
    title: show('title', event.title),
    coverUrl: show('cover', event.cover_url),
    // A hidden cover is drawn blurred from a tiny copy (GET …/locked-cover),
    // never from the original.
    blurredCover: !reveal.has('cover') && Boolean(event.cover_url),
    logoUrl: show('organizer', event.logo_url),
    organizer: reveal.has('organizer') && organizer ? { name: organizer.display_name } : null,
    startsAt: show('date', event.starts_at),
    timezone: show('date', event.timezone),
    city: show('city', event.city),
    // The organizer's length rule, stated on the password screen — only when
    // they set one (the owner chose to show guests the range, 2026-11-22).
    passwordRule: event.access_password_min != null || event.access_password_max != null
      ? ruleOf(event) : null,
  };
}

/** The one refusal, identical everywhere so no page leaks more than another. */
function lockedFailure(event) {
  return {
    status: 403,
    error: 'EVENT_PRIVATE',
    message: 'This event is private. Enter the password to see it.',
    meta: { event: lockedTeaser(event) },
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SENDS THE REFUSAL — as a 200 when the website's cached read asks for it
 * (`?locked=ok`), the 403 above for everyone else.
 *
 * Why (found 2026-11-22: a new extra showed on the checkout and never on the
 * event page): the website reads an event page through Next's data cache,
 * which stores only status-200 answers. A page cached while the event was
 * PUBLIC was then refreshed after it went private; the refresh got a 403,
 * which Next does not store, so the old public copy stayed — served to
 * everyone, without the password, and frozen (no new extras, no edits) until
 * an on-demand revalidation happened to land. A 200 "locked" answer is
 * stored like any other, so the cached copy turns into the lock within a
 * minute even if that revalidation never arrives. It carries only the teaser
 * the 403 already carries.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function sendLocked(req, res, partial) {
  const { sendOk, sendFail } = require('../utils/responseEnvelope');
  const event = await teaserRow(partial);
  const refusal = lockedFailure(event);
  if (req?.query?.locked === 'ok') {
    return sendOk(res, { locked: true, code: refusal.error, message: refusal.message, event: refusal.meta.event });
  }
  return sendFail(res, refusal);
}

/**
 * The row a teaser is built from. Callers select different columns for their
 * own work; rather than every one of them knowing the teaser's needs, a row
 * missing any of them is read once more, by id. Never fails the refusal: on a
 * read error the row it was given is used.
 */
async function teaserRow(event) {
  const complete = ['starts_at', 'timezone', 'city', 'organizers', 'locked_reveal', 'locked_preview']
    .every((k) => event && k in event);
  if (complete || !event?.id) return event;
  try {
    const { data, error } = await supabase.from('events').select(TEASER_COLUMNS).eq('id', event.id).maybeSingle();
    if (error || !data) return event;
    return { ...event, ...data };
  } catch {
    return event;
  }
}

/**
 * Check a password for an event, by slug. Plain false for every failure:
 * wrong password, not private, not published, not found.
 */
async function verify(slug, password) {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, slug, status, is_private, access_password_hash, access_password_set_at, access_password_min, access_password_max')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!event || event.status !== 'published' || !event.is_private || !event.access_password_hash) {
    return { ok: false, event: null };
  }
  // Trimmed, as it was when set (`hashNew`): a stray space pasted on either
  // side must not lock every guest out.
  const value = String(password || '').trim();
  // Outside the organizer's length rule cannot be the password — answered
  // as a plain mismatch, without spending a hash on it.
  if (!fits(value, ruleOf(event))) return { ok: false, event: null };
  const { ok } = await verifyPassword(value, event.access_password_hash);
  return { ok, event: ok ? event : null };
}

/**
 * Validate and hash a new password against a length rule (the organizer's,
 * or the default). Throws a `{ code: 'VALIDATION_ERROR' }`.
 */
async function hashNew(password, rule = DEFAULT_RULE) {
  const value = typeof password === 'string' ? password.trim() : '';
  if (!fits(value, rule)) {
    const err = new Error(rule.min === rule.max
      ? `Use a password of exactly ${rule.min} characters.`
      : `Use a password of ${rule.min} to ${rule.max} characters.`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return hashPassword(value);
}

function setCookie(res, event, token) {
  res.cookie(cookieName(event.id), token, cookieOptions());
}

/**
 * Route guard for the event's other public pages — sponsors, vendors, the
 * "notify me" list, a vendor's booking. Put it after `optionalAuth` so the
 * organizer is recognised.
 *
 * Only ever refuses a PRIVATE event the request has not unlocked. Anything
 * else — a public event, an unknown slug, an unpublished one — goes through
 * untouched, so each handler keeps answering those exactly as it did.
 */
function gate({ slugFrom = (req) => req.params.slug } = {}) {
  return async (req, res, next) => {
    try {
      const slug = slugFrom(req);
      if (!slug) return next();
      const { data: event, error } = await supabase
        .from('events')
        .select(`id, slug, title, status, cover_url, logo_url, starts_at, timezone, city, ${ACCESS_COLUMNS}, organizers ( display_name )`)
        .eq('slug', String(slug))
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!event || event.status !== 'published' || !event.is_private) return next();
      res.set('Cache-Control', 'private, no-store');
      if (await allowed(req, event)) return next();
      return sendLocked(req, res, event);
    } catch (err) { return next(err); }
  };
}

module.exports = {
  REVEAL_KEYS,
  DEFAULT_REVEAL,
  PREVIEWS,
  cleanReveal,
  lockedTeaser,
  TOKEN_TYPE,
  ACCESS_TTL_HOURS,
  ACCESS_COLUMNS,
  HEADER,
  PASSWORD_MIN,
  PASSWORD_MAX,
  HARD_MIN,
  HARD_MAX,
  DEFAULT_RULE,
  ruleOf,
  validRule,
  cookieName,
  listed,
  issueToken,
  tokenValid,
  canView,
  allowed,
  rememberUnlock,
  lockedTeaser,
  lockedFailure,
  sendLocked,
  verify,
  hashNew,
  setCookie,
  gate,
};
