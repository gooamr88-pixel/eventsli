const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE STAGE SCREEN SHOWS BY ITSELF (2026-11-25).
 *
 * The 3D room's LED wall plays the organizer's slides (venueStudio.js,
 * `scene.screen`). Four of them fill themselves from the event, so an
 * organizer who never opens the screen settings still gets a show:
 *
 *   title      the event's name, date and venue, over its cover image
 *   countdown  the time to `starts_at`, then "Live now" until `ends_at`
 *   lineup     the running order (`event_schedule`), times in the event's zone
 *   sponsors   the logos on the event page (`event_sponsors`)
 *
 * All of it is already public on the event page, and the seat map that
 * carries it is behind the same password a private event's page is. Nothing
 * here is new information, only a second place to show it.
 *
 * NEVER A REASON FOR THE MAP TO FAIL. A lineup or sponsor read that errors is
 * logged and left empty: the screen then skips those slides, and a buyer
 * still chooses their seat.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const EVENT_COLUMNS = 'id, title, starts_at, ends_at, timezone, venue_name, cover_url, logo_url';
const MAX_ROWS = 12;

/** Pure: the event row and its rows, as the screen reads them. */
function shapeFeed(event, schedule = [], sponsors = []) {
  return {
    title: event.title || '',
    startsAt: event.starts_at || null,
    endsAt: event.ends_at || null,
    timezone: event.timezone || null,
    venueName: event.venue_name || null,
    coverUrl: event.cover_url || null,
    logoUrl: event.logo_url || null,
    lineup: (schedule || []).filter((r) => r && r.title).slice(0, MAX_ROWS).map((r) => ({
      title: String(r.title).slice(0, 160),
      startsAt: r.starts_at || null,
      endsAt: r.ends_at || null,
      location: r.location ? String(r.location).slice(0, 120) : null,
    })),
    sponsors: (sponsors || []).filter((r) => r && r.name).slice(0, MAX_ROWS).map((r) => ({
      name: String(r.name).slice(0, 120),
      logoUrl: r.logo_url || null,
      level: r.level || 'partner',
    })),
  };
}

async function rowsOf(what, eventId, query) {
  const { data, error } = await query;
  if (error) {
    logger.warn({ err: error.message, eventId }, `stage screen: ${what} could not be read`);
    return [];
  }
  return data || [];
}

/** The feed for an event row that carries EVENT_COLUMNS. */
async function screenFeed(event) {
  const [schedule, sponsors] = await Promise.all([
    rowsOf('lineup', event.id, supabase.from('event_schedule')
      .select('title, starts_at, ends_at, location')
      .eq('event_id', event.id)
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('sort_order')
      .limit(MAX_ROWS)),
    rowsOf('sponsors', event.id, supabase.from('event_sponsors')
      .select('name, logo_url, level')
      .eq('event_id', event.id)
      .order('level')
      .order('sort_order')
      .limit(MAX_ROWS)),
  ]);
  return shapeFeed(event, schedule, sponsors);
}

/** The feed by event id, for the organizer's editor. Null when it cannot be read. */
async function screenFeedFor(eventId) {
  const { data: event, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  if (error || !event) {
    if (error) logger.warn({ err: error.message, eventId }, 'stage screen: event could not be read');
    return null;
  }
  return screenFeed(event);
}

module.exports = { screenFeed, screenFeedFor, shapeFeed, EVENT_COLUMNS };
