const { supabase } = require('../config/supabase');
const discovery = require('../controllers/discoveryController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP events — the homepage hero's slider (owner request, 2026-11-15).
 *
 * An admin chooses up to twelve events and their order in the console; the
 * homepage slides through them. Stored as `events.vip_rank` (migration
 * 20261119090000), written whole by `set_vip_events` so a save is all or
 * nothing.
 *
 * WHAT THE PUBLIC SEES is narrower than what the admin ranked: only events that
 * are published and not yet over. A ranked event that is unpublished, cancelled
 * or finished simply drops off the slider until it qualifies again, and the
 * console says so beside it — the admin never has to remember to tidy up.
 *
 * WHEN NOTHING IS RANKED (or every ranked event has lapsed) the slider falls
 * back to the soonest upcoming events that have a cover, flagged `vip: false`,
 * so a new platform's homepage is never an empty frame. The VIP badge is only
 * ever drawn on an event an admin actually chose.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_VIP = 12;
const FALLBACK_COUNT = 6;

class VipEventsError extends Error {
  constructor(message, code = 'VALIDATION_ERROR', meta) {
    super(message);
    this.code = code;
    this.meta = meta;
  }
}

/** The public card shape, plus the lowest price and whether an admin chose it. */
async function withPrices(rows, vip) {
  const prices = await discovery.lowestTierPrices(rows);
  return rows.map((e) => ({ ...discovery.shape(e), fromPriceCents: prices.get(e.id) ?? null, vip }));
}

/** GET /public/vip-events */
async function listPublic({ now = new Date() } = {}) {
  const at = now.toISOString();
  const { data, error } = await supabase
    .from('events')
    .select(discovery.SELECT)
    .eq('status', 'published')
    .eq('is_private', false)
    .gte('ends_at', at)
    .not('vip_rank', 'is', null)
    .order('vip_rank', { ascending: true })
    .limit(MAX_VIP);
  if (error) throw error;
  if (data && data.length > 0) return { events: await withPrices(data, true), chosen: true };

  const { data: soon, error: soonError } = await supabase
    .from('events')
    .select(discovery.SELECT)
    .eq('status', 'published')
    .eq('is_private', false)
    .gte('ends_at', at)
    .not('cover_url', 'is', null)
    .order('starts_at', { ascending: true })
    .limit(FALLBACK_COUNT);
  if (soonError) throw soonError;
  return { events: await withPrices(soon || [], false), chosen: false };
}

/** GET /admin/storefront/vip-events — every ranked event, whatever its state. */
async function listAdmin({ now = new Date() } = {}) {
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, title, status, starts_at, ends_at, timezone, venue_name, city, cover_url, vip_rank, is_private')
    .not('vip_rank', 'is', null)
    .order('vip_rank', { ascending: true });
  if (error) throw error;
  return (data || []).map((e) => adminRow(e, now));
}

function adminRow(e, now = new Date()) {
  const over = e.ends_at && new Date(e.ends_at) < now;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    status: e.status,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    timezone: e.timezone,
    venue: e.venue_name,
    city: e.city,
    coverUrl: e.cover_url,
    vipRank: e.vip_rank,
    // Why a ranked event is not on the homepage right now, in words the
    // console shows beside it. Null when it is live on the slider.
    hidden: e.status !== 'published' ? 'Not published' : over ? 'Event has ended'
      // Behind a password (2026-11-22): never on a public listing.
      : e.is_private === true ? 'Private event' : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PUT /admin/storefront/vip-events — replace the list, in order. */
async function save(eventIds, { now = new Date() } = {}) {
  if (!Array.isArray(eventIds)) throw new VipEventsError('Send the events in their order.');
  const ids = [...new Set(eventIds.map((v) => String(v).trim()))];
  if (ids.some((id) => !UUID.test(id))) throw new VipEventsError('One of those is not an event.');
  if (ids.length > MAX_VIP) {
    throw new VipEventsError(`The slider holds at most ${MAX_VIP} events.`, 'VALIDATION_ERROR', { max: MAX_VIP });
  }

  if (ids.length > 0) {
    // Only an event a buyer could open belongs on the homepage. Checked here so
    // the admin is told which one and why, rather than seeing it vanish.
    const { data, error } = await supabase
      .from('events').select('id, title, status, ends_at').in('id', ids);
    if (error) throw error;
    const found = new Map((data || []).map((e) => [e.id, e]));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new VipEventsError('One of those events no longer exists.', 'NOT_FOUND', { ids: missing });
    const unfit = ids.map((id) => found.get(id)).find((e) => e.status !== 'published' || new Date(e.ends_at) < now);
    if (unfit) {
      throw new VipEventsError(
        `"${unfit.title}" is ${unfit.status !== 'published' ? 'not published' : 'already over'}, so it cannot be on the homepage.`,
        'VALIDATION_ERROR',
        { id: unfit.id },
      );
    }
  }

  const { error } = await supabase.rpc('set_vip_events', { p_event_ids: ids });
  if (error) throw error;
  return listAdmin({ now });
}

module.exports = { listPublic, listAdmin, save, adminRow, VipEventsError, MAX_VIP };
