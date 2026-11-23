const { supabase } = require('../config/supabase');
const { parsePagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const discovery = require('../controllers/discoveryController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The signed-in person's own things, for the attendee app (2026-11-24):
 * saved events, the notification inbox, and the phones that receive pushes.
 *
 * Every query here is scoped by `req.user.id` from the session and nothing
 * else. The API uses the service role, which bypasses row-level security, so
 * that `.eq('user_id', …)` IS the access control — there is no id in a URL or
 * a body that could name somebody else's row.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NOT_FOUND = { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.' };

// ─── Saved events ──────────────────────────────────────────────────────────

/**
 * GET /me/saved-events — the hearted events, newest save first, as the same
 * cards the listing shows (price, sold-out tags, private events locked).
 *
 * Only PUBLISHED events, and the count agrees with the page: the inner join
 * filters before the range, so an event that went back to draft neither shows
 * nor leaves a hole in page two. The row stays, and reappears if it returns.
 */
async function savedEvents(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });
    const { data: saved, count, error } = await supabase
      .from('saved_events')
      .select('event_id, created_at, events!inner ( status )', { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('events.status', 'published')
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (error) throw new Error(error.message);
    if (!saved?.length) return sendOk(res, [], { pagination: buildMeta(p, count) });

    const ids = saved.map((s) => s.event_id);
    const { data: events, error: evError } = await supabase
      .from('events').select(discovery.SELECT).in('id', ids).eq('status', 'published');
    if (evError) throw new Error(evError.message);

    const open = (events || []).filter((e) => e.is_private !== true);
    const [prices, avail] = await Promise.all([
      discovery.lowestTierPrices(open),
      discovery.listingAvailability(open),
    ]);
    const byId = new Map((events || []).map((e) => [e.id, e]));
    const cards = saved
      .map((s) => {
        const e = byId.get(s.event_id);
        if (!e) return null;
        const card = e.is_private === true
          ? discovery.lockedListing(e)
          : { ...discovery.shape(e), fromPriceCents: prices.get(e.id) ?? null, availability: avail.get(e.id) ?? null };
        return { ...card, savedAt: s.created_at };
      })
      .filter(Boolean);

    return sendOk(res, cards, { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

/**
 * GET /me/saved-events/ids — just the ids, so every heart on every card can
 * be drawn filled or empty without fetching the saved list. Bounded: a person
 * with more saves than this sees the newest ones filled.
 */
const MAX_SAVED_IDS = 1000;
async function savedEventIds(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('saved_events').select('event_id')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_SAVED_IDS);
    if (error) throw new Error(error.message);
    return sendOk(res, { eventIds: (data || []).map((r) => r.event_id) });
  } catch (err) { return next(err); }
}

/**
 * PUT /me/saved-events/:eventId — idempotent: saving a saved event is a
 * success, not a conflict, because a double tap is the normal case.
 *
 * Only a published event can be saved. Anything else answers exactly as a
 * missing one does, the rule discoveryController keeps for every public read:
 * a different answer would let anyone probe which drafts exist.
 */
async function saveEvent(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events').select('id').eq('id', req.params.eventId).eq('status', 'published').maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) return sendFail(res, NOT_FOUND);

    const { error: saveError } = await supabase.from('saved_events')
      .upsert({ user_id: req.user.id, event_id: event.id }, { onConflict: 'user_id,event_id', ignoreDuplicates: true });
    if (saveError) throw new Error(saveError.message);
    return sendOk(res, { eventId: event.id, saved: true });
  } catch (err) { return next(err); }
}

/** DELETE /me/saved-events/:eventId — idempotent, like the save. */
async function unsaveEvent(req, res, next) {
  try {
    const { error } = await supabase.from('saved_events')
      .delete().eq('user_id', req.user.id).eq('event_id', req.params.eventId);
    if (error) throw new Error(error.message);
    return sendOk(res, { eventId: req.params.eventId, saved: false });
  } catch (err) { return next(err); }
}

// ─── Notifications ─────────────────────────────────────────────────────────

function shapeNotification(n) {
  const event = Array.isArray(n.events) ? n.events[0] : n.events;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    // What a tap opens. The slug only while the event is public — a tap on a
    // cancelled or unpublished event's notice opens nothing rather than a 404.
    eventId: n.event_id,
    eventSlug: event?.status === 'published' ? event.slug : null,
    coverUrl: event?.status === 'published' ? event.cover_url || null : null,
    orderId: n.order_id,
    read: Boolean(n.read_at),
    createdAt: n.created_at,
  };
}

async function unreadCount(userId) {
  const { count, error } = await supabase.from('user_notifications')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  if (error) throw new Error(error.message);
  return Number(count) || 0;
}

/** GET /me/notifications — newest first; `meta.unread` drives the badge. */
async function notifications(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });
    const [{ data, count, error }, unread] = await Promise.all([
      supabase.from('user_notifications')
        .select('id, kind, title, body, event_id, order_id, read_at, created_at, events ( slug, status, cover_url )',
          { count: 'exact' })
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .range(p.from, p.to),
      unreadCount(req.user.id),
    ]);
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map(shapeNotification), {
      pagination: buildMeta(p, count),
      meta: { unread },
    });
  } catch (err) { return next(err); }
}

/** POST /me/notifications/read — `{ ids }` marks those, `{ all: true }` marks everything. */
async function markRead(req, res, next) {
  try {
    let q = supabase.from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('read_at', null);
    if (req.body.all !== true) q = q.in('id', req.body.ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return sendOk(res, { unread: await unreadCount(req.user.id) });
  } catch (err) { return next(err); }
}

// ─── Push devices ──────────────────────────────────────────────────────────

/**
 * POST /me/push-devices — this phone receives this account's pushes.
 *
 * The token is the key, so a phone that signs in as somebody else MOVES the
 * token to them: the previous account stops receiving pushes on a phone it is
 * no longer signed in on, which is the whole point. A token Expo had reported
 * dead is revived by registering again.
 */
async function registerDevice(req, res, next) {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('push_devices').upsert({
      token: req.body.token,
      user_id: req.user.id,
      platform: req.body.platform,
      last_seen_at: now,
      disabled_at: null,
    }, { onConflict: 'token' });
    if (error) throw new Error(error.message);
    return sendOk(res, { registered: true });
  } catch (err) { return next(err); }
}

/** DELETE /me/push-devices — on sign-out. Only this account's row for that token. */
async function removeDevice(req, res, next) {
  try {
    const { error } = await supabase.from('push_devices')
      .delete().eq('token', req.body.token).eq('user_id', req.user.id);
    if (error) throw new Error(error.message);
    return sendOk(res, { registered: false });
  } catch (err) { return next(err); }
}

module.exports = {
  savedEvents,
  savedEventIds,
  saveEvent,
  unsaveEvent,
  notifications,
  markRead,
  registerDevice,
  removeDevice,
  shapeNotification,
  MAX_SAVED_IDS,
};
