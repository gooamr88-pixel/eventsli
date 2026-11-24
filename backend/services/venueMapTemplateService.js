const { supabase } = require('../config/supabase');
const venue = require('./venueService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map library (owner, 2026-11-24): seating maps of real venues,
 * ready to drop into an event's Venue Builder. Table `venue_map_templates`,
 * migration 20261214090000.
 *
 * MAP ONLY (the owner's rule). A template holds the room — tables and rows,
 * their shapes and seat counts, areas, walls, the venue's size, the map look
 * and the Studio's sections — and NEVER ticket types, prices, add-ons, sales,
 * passwords or event details. The one thing kept beside the room is each
 * table's colour GROUP (its table category's name and colour: "VIP", "Floor"),
 * because a printed seating chart is zoned that way; on use a group finds the
 * event's category of the same name, or is left for the organizer to assign.
 *
 * TWO LIBRARIES.
 *   platform   Eventsli's, built by super admins from an event already held at
 *              the venue, from the venue's seating-chart picture (read by AI in
 *              the browser and sent here as map data), or from an organizer's
 *              saved map. Draft → published → hidden.
 *   organizer  An organizer's own maps, saved from the Venue Builder.
 *
 * USING ONE happens in the Venue Builder: the map lands in the unsaved draft
 * (one undo puts the old one back) and `markUsed` counts it. Nothing here
 * writes an event's map — the editor's own Save does, with every rule it has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_PER_ORGANIZER = 50;
const MAX_DATA_BYTES = 900 * 1024;
const VERSION = 1;
const KINDS = ['arena', 'stadium', 'theatre', 'concert_hall', 'ballroom', 'banquet_hall', 'conference', 'club', 'outdoor', 'other'];
const STATUSES = ['draft', 'published', 'hidden'];
const TABLE = 'venue_map_templates';

const CARD = 'id, scope, organizer_id, name, description, venue_name, venue_address, city, region, country, '
  + 'venue_place_id, venue_lat, venue_lng, venue_kind, status, featured, verified, sort_order, summary, source, '
  + 'source_note, source_event_id, copied_from_id, use_count, created_at, updated_at';

class VenueMapError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => new VenueMapError(code, message);

function missingTable(error) {
  return error && /venue_map_templates|bump_venue_map_template_use/.test(String(error.message || ''))
    && /does not exist|schema cache|not find/i.test(String(error.message || ''));
}
function check(error, what) {
  if (!error) return;
  if (missingTable(error)) throw fail('FEATURE_DISABLED', 'The venue map library is not switched on yet.');
  throw new Error(`venue maps: ${what}: ${error.message}`);
}

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const escapeLike = (s) => String(s).replace(/[%_\\]/g, (m) => `\\${m}`);

function card(row) {
  return {
    id: row.id,
    scope: row.scope,
    organizerId: row.organizer_id,
    name: row.name,
    description: row.description,
    venue: {
      name: row.venue_name,
      address: row.venue_address,
      city: row.city,
      region: row.region,
      country: row.country,
      placeId: row.venue_place_id,
      lat: row.venue_lat,
      lng: row.venue_lng,
      kind: row.venue_kind,
    },
    status: row.status,
    featured: row.featured,
    verified: row.verified,
    sortOrder: row.sort_order,
    summary: row.summary || {},
    source: row.source,
    sourceNote: row.source_note,
    sourceEventId: row.source_event_id,
    copiedFromId: row.copied_from_id,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ── the map itself ─────────────────────────────────────────────────────── */

/**
 * The layout blob without anything that belongs to one event: its 360° views
 * and the venue photo live in that event's storage.
 */
function roomLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {};
  const out = { ...layout };
  delete out.views;
  if (out.venue && typeof out.venue === 'object') {
    out.venue = { ...out.venue };
    delete out.venue.photo;
  }
  return out;
}

const SHAPE = /^[a-z][a-z0-9_]{0,23}$/;
const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/**
 * Map data as a template stores it, checked — whether it came from an event
 * (already valid) or from the browser (a picture read by AI). Throws
 * VALIDATION_ERROR on anything a Venue Builder could not load.
 */
function cleanData(input) {
  if (!input || typeof input !== 'object') throw fail('VALIDATION_ERROR', 'Send the map to save.');
  const rawTables = Array.isArray(input.tables) ? input.tables : [];
  if (rawTables.length > venue.MAX_TABLES) {
    throw fail('VALIDATION_ERROR', `A map can hold at most ${venue.MAX_TABLES} tables.`);
  }
  const groups = (Array.isArray(input.groups) ? input.groups : []).slice(0, 50).map((g, i) => ({
    key: text(g?.key, 20) || `g${i + 1}`,
    name: text(g?.name, 60),
    color: /^#[0-9a-f]{6}$/i.test(g?.color || '') ? g.color : null,
  })).filter((g) => g.name);
  const groupKeys = new Set(groups.map((g) => g.key));

  const seen = new Set();
  const tables = rawTables.map((t) => {
    const label = text(t?.label, 40);
    const seatCount = Math.round(Number(t?.seatCount));
    const x = num(t?.position?.x, -50, 150);
    const y = num(t?.position?.y, -50, 150);
    if (!label || !Number.isFinite(seatCount) || seatCount < 1 || seatCount > venue.MAX_SEATS_PER_TABLE || x === null || y === null) {
      throw fail('VALIDATION_ERROR', `The table "${label || '?'}" is not complete: it needs a name, 1 to ${venue.MAX_SEATS_PER_TABLE} seats and a place on the map.`);
    }
    if (seen.has(label.toLowerCase())) throw fail('VALIDATION_ERROR', `Two tables are called "${label}". Every table needs its own name.`);
    seen.add(label.toLowerCase());
    const section = text(t.section, 40);
    const groupKey = text(t.groupKey, 20);
    return {
      label,
      seatCount,
      shape: typeof t.shape === 'string' && SHAPE.test(t.shape) ? t.shape : 'round',
      position: { x, y, rotation: num(t.position.rotation, -360, 360) || 0 },
      ...(section ? { section, row: text(t.row, 8) || 'A' } : {}),
      ...(groupKey && groupKeys.has(groupKey) ? { groupKey } : {}),
    };
  });

  const layout = roomLayout(input.layout);
  const zones = Array.isArray(layout.zones) ? layout.zones : [];
  if (tables.length === 0 && zones.length === 0) {
    throw fail('VALIDATION_ERROR', 'This map is empty. Add tables, rows or areas first.');
  }
  const data = { version: VERSION, layout, tables, groups };
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DATA_BYTES) {
    throw fail('VALIDATION_ERROR', 'This map is too large to save as a template.');
  }
  return data;
}

/** The figures a card shows. */
function summarize(data) {
  const tables = data.tables || [];
  const zones = Array.isArray(data.layout?.zones) ? data.layout.zones : [];
  const sections = new Set(tables.map((t) => t.section).filter(Boolean));
  const world = data.layout?.world;
  return {
    tables: tables.filter((t) => !t.section).length,
    rows: tables.filter((t) => t.section).length,
    sections: sections.size,
    seats: tables.reduce((n, t) => n + (Number(t.seatCount) || 0), 0),
    areas: zones.filter((z) => z && z.kind !== 'wall').length,
    walls: zones.filter((z) => z && z.kind === 'wall').length,
    groups: (data.groups || []).map((g) => g.name).slice(0, 12),
    standing: Math.round(Number(data.layout?.venue?.standingCapacity) || 0),
    world: world && Number(world.width) && Number(world.height) ? { width: Number(world.width), height: Number(world.height) } : null,
    sketch: sketchOf(data),
  };
}

/**
 * A few kilobytes that let a card draw the room without the whole map: every
 * table as [x, y, row?, size, rotation] and every area as [x, y, w, h,
 * rotation, kind] in world units, rounded. Sizes are estimates from the seat
 * count (a seat is about 22 units), good for a thumbnail and nothing else.
 */
function sketchOf(data) {
  const w = Number(data.layout?.world?.width) || 1000;
  const h = Number(data.layout?.world?.height) || 700;
  const r = (v) => Math.round(v);
  const t = (data.tables || []).slice(0, 400).map((x) => {
    const n = Number(x.seatCount) || 1;
    const row = Boolean(x.section) || x.shape === 'row';
    const size = row ? n * 22 : (n * 22) / (2 * Math.PI) + 12;
    return [r((x.position.x / 100) * w), r((x.position.y / 100) * h), row ? 1 : 0, r(size), r(x.position.rotation || 0)];
  });
  const zones = Array.isArray(data.layout?.zones) ? data.layout.zones : [];
  const z = zones.slice(0, 120).filter((x) => x && typeof x === 'object').map((x) => {
    const kind = x.kind === 'wall' ? 'w' : x.kind === 'stage' ? 's' : x.kind === 'text' ? 't' : 'a';
    return [r(((Number(x.x) || 0) / 100) * w), r(((Number(x.y) || 0) / 100) * h), r(Number(x.w) || 80), r(Number(x.h) || 50), r(Number(x.rotation) || 0), kind];
  }).filter((x) => x[5] !== 't');
  return { w: r(w), h: r(h), t, z };
}

/**
 * An event's saved map, as template data, with the event's venue. Throws
 * NOT_FOUND when the event is not there (or not this organizer's).
 */
async function snapshotEvent(eventId, { organizerId = null } = {}) {
  let q = supabase.from('events').select(
    'id, organizer_id, title, venue_name, venue_address, venue_region, city, country, venue_place_id, venue_lat, venue_lng',
  ).eq('id', eventId);
  if (organizerId) q = q.eq('organizer_id', organizerId);
  let { data: e, error } = await q.maybeSingle();
  // venue_region arrived with 20261208090000; read without it on an older schema.
  if (error && /venue_region/.test(error.message || '')) {
    let q2 = supabase.from('events').select(
      'id, organizer_id, title, venue_name, venue_address, city, country, venue_place_id, venue_lat, venue_lng',
    ).eq('id', eventId);
    if (organizerId) q2 = q2.eq('organizer_id', organizerId);
    ({ data: e, error } = await q2.maybeSingle());
  }
  if (error) throw new Error(`venue maps: event read failed: ${error.message}`);
  if (!e) throw fail('NOT_FOUND', 'That event does not exist.');

  const [map, { data: cats, error: catErr }] = await Promise.all([
    venue.getMapForOrganizer(eventId),
    supabase.from('table_categories').select('id, name, color, sort_order').eq('event_id', eventId).order('sort_order'),
  ]);
  if (catErr) throw new Error(`venue maps: category read failed: ${catErr.message}`);
  if (!map) throw fail('VALIDATION_ERROR', 'This event has no saved map yet. Draw it in the Venue Builder and save it first.');

  const groupKey = new Map((cats || []).map((c, i) => [c.id, `g${i + 1}`]));
  const used = new Set((map.tables || []).map((t) => t.categoryId).filter(Boolean));
  const data = cleanData({
    layout: map.layout,
    groups: (cats || []).filter((c) => used.has(c.id)).map((c) => ({ key: groupKey.get(c.id), name: c.name, color: c.color })),
    tables: (map.tables || []).map((t) => ({
      label: t.label,
      seatCount: t.seatCount,
      shape: t.shape,
      position: t.position,
      ...(t.section ? { section: t.section, row: t.row } : {}),
      ...(t.categoryId ? { groupKey: groupKey.get(t.categoryId) } : {}),
    })),
  });
  return { event: e, data, summary: summarize(data) };
}

/** The venue fields of a row, from an event or from what an admin typed. */
function venueRow(v = {}) {
  const lat = finite(v.lat);
  const lng = finite(v.lng);
  const both = lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const country = typeof v.country === 'string' && /^[A-Za-z]{2}$/.test(v.country.trim()) ? v.country.trim().toUpperCase() : null;
  return {
    venue_name: text(v.name, 120),
    venue_address: text(v.address, 300),
    city: text(v.city, 120),
    region: text(v.region, 120),
    country,
    venue_place_id: text(v.placeId, 300),
    venue_lat: both ? lat : null,
    venue_lng: both ? lng : null,
    ...(v.kind !== undefined ? { venue_kind: KINDS.includes(v.kind) ? v.kind : 'other' } : {}),
  };
}

const eventVenue = (e) => ({
  name: e.venue_name, address: e.venue_address, city: e.city, region: e.venue_region, country: e.country,
  placeId: e.venue_place_id, lat: e.venue_lat, lng: e.venue_lng,
});

/* ── reading ────────────────────────────────────────────────────────────── */

async function eventVenueOf(organizerId, eventId) {
  if (!eventId) return null;
  const { data, error } = await supabase.from('events')
    .select('id, venue_name, city, country, venue_place_id').eq('id', eventId).eq('organizer_id', organizerId).maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Does this template's venue look like the event's? The Google place first;
 * else the same venue name in the same city.
 */
function sameVenue(t, ev) {
  if (!ev) return false;
  if (t.venue.placeId && ev.venue_place_id) return t.venue.placeId === ev.venue_place_id;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return Boolean(ev.venue_name) && norm(t.venue.name) === norm(ev.venue_name)
    && (!t.venue.city || !ev.city || norm(t.venue.city) === norm(ev.city));
}

/**
 * The organizer's maps and Eventsli's published library. With an event, the
 * ones of that event's venue come back as `forVenue` as well, first.
 */
async function listForOrganizer(organizerId, { eventId = null } = {}) {
  const [mine, library, ev] = await Promise.all([
    supabase.from(TABLE).select(CARD).eq('scope', 'organizer').eq('organizer_id', organizerId)
      .order('updated_at', { ascending: false }),
    supabase.from(TABLE).select(CARD).eq('scope', 'platform').eq('status', 'published')
      .order('featured', { ascending: false }).order('sort_order').order('venue_name'),
    eventVenueOf(organizerId, eventId),
  ]);
  if (missingTable(mine.error) || missingTable(library.error)) {
    return { mine: [], library: [], forVenue: [], enabled: false, venue: null };
  }
  check(mine.error, 'list');
  check(library.error, 'list');
  const m = (mine.data || []).map(card);
  const l = (library.data || []).map(card);
  return {
    enabled: true,
    mine: m,
    library: l,
    forVenue: ev ? [...l, ...m].filter((t) => sameVenue(t, ev)) : [],
    venue: ev ? { name: ev.venue_name, city: ev.city } : null,
  };
}

/** One template in full, if this organizer may see it. */
async function getForOrganizer(organizerId, id) {
  const { data, error } = await supabase.from(TABLE).select(`${CARD}, data`).eq('id', id).maybeSingle();
  check(error, 'read');
  const visible = data && (
    (data.scope === 'organizer' && data.organizer_id === organizerId)
    || (data.scope === 'platform' && data.status === 'published'));
  if (!visible) throw fail('NOT_FOUND', 'That map does not exist.');
  return { ...card(data), data: data.data };
}

async function getAny(id) {
  const { data, error } = await supabase.from(TABLE).select(`${CARD}, data`).eq('id', id).maybeSingle();
  check(error, 'read');
  if (!data) throw fail('NOT_FOUND', 'That map does not exist.');
  return { ...card(data), data: data.data };
}

/** Every template of one library, for the admin console. */
async function listForAdmin({ scope = 'platform', q = '', status = null, kind = null } = {}) {
  let query = supabase.from(TABLE).select(`${CARD}, organizers ( display_name )`).eq('scope', scope);
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (kind && KINDS.includes(kind)) query = query.eq('venue_kind', kind);
  // Commas, brackets and quotes would change the meaning of the or() filter.
  const term = String(q || '').replace(/[,()"\\]/g, ' ').trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    query = query.or(`venue_name.ilike.${like},name.ilike.${like},city.ilike.${like}`);
  }
  query = scope === 'platform'
    ? query.order('featured', { ascending: false }).order('sort_order').order('venue_name')
    : query.order('updated_at', { ascending: false }).limit(200);
  const { data, error } = await query;
  if (missingTable(error)) return { templates: [], enabled: false };
  check(error, 'admin list');
  return {
    enabled: true,
    templates: (data || []).map((r) => ({ ...card(r), organizerName: r.organizers?.display_name || null })),
  };
}

/**
 * "Events already held here" — the fastest way to a venue's real map: any
 * event on Eventsli at that place (or of that name in that city) whose map
 * has something on it.
 */
async function eventsAtVenue({ placeId = null, name = null, city = null } = {}) {
  const cols = 'id, title, status, starts_at, venue_name, city, organizers ( display_name ), venue_maps ( id )';
  let q = supabase.from('events').select(cols).order('starts_at', { ascending: false }).limit(12);
  if (placeId) q = q.eq('venue_place_id', placeId);
  else if (text(name, 120)) {
    q = q.ilike('venue_name', `%${escapeLike(text(name, 120))}%`);
    if (text(city, 120)) q = q.ilike('city', `%${escapeLike(text(city, 120))}%`);
  } else return [];
  const { data, error } = await q;
  if (error) throw new Error(`venue maps: venue events failed: ${error.message}`);
  const withMap = (data || []).filter((e) => (Array.isArray(e.venue_maps) ? e.venue_maps.length : e.venue_maps));
  const counts = await Promise.all(withMap.map(async (e) => {
    const mapId = Array.isArray(e.venue_maps) ? e.venue_maps[0]?.id : e.venue_maps?.id;
    const { count } = await supabase.from('tables').select('id', { count: 'exact', head: true }).eq('venue_map_id', mapId);
    return count || 0;
  }));
  return withMap.map((e, i) => ({
    id: e.id, title: e.title, status: e.status, startsAt: e.starts_at, venueName: e.venue_name, city: e.city,
    organizerName: e.organizers?.display_name || null, tables: counts[i],
  }));
}

/* ── writing ────────────────────────────────────────────────────────────── */

async function countFor(organizerId) {
  const { count, error } = await supabase.from(TABLE)
    .select('id', { count: 'exact', head: true }).eq('scope', 'organizer').eq('organizer_id', organizerId);
  check(error, 'count');
  return count || 0;
}

async function roomFor(organizerId) {
  if ((await countFor(organizerId)) >= MAX_PER_ORGANIZER) {
    throw fail('VALIDATION_ERROR', `You can keep up to ${MAX_PER_ORGANIZER} saved maps. Delete one to save another.`);
  }
}

async function insert(row) {
  if (!row.venue_name || row.venue_name.length < 2) {
    throw fail('VALIDATION_ERROR', 'Name the venue this map belongs to.');
  }
  const { data, error } = await supabase.from(TABLE).insert(row).select(CARD).single();
  check(error, 'save');
  return card(data);
}

function layoutName(name, fallback) {
  const n = text(name, 80);
  if (n && n.length >= 2) return n;
  return fallback;
}

/**
 * An organizer's map saved to their library, from one of their events. The
 * venue comes from the event; `venueKind` from the Studio's venue type when
 * not given.
 */
async function saveFromEvent({ organizerId, eventId, name, description, venueKind, createdBy }) {
  await roomFor(organizerId);
  const snap = await snapshotEvent(eventId, { organizerId });
  const kind = KINDS.includes(venueKind) ? venueKind : kindFromStudio(snap.data.layout);
  return insert({
    scope: 'organizer',
    organizer_id: organizerId,
    name: layoutName(name, `${snap.event.title}`.slice(0, 80)),
    description: text(description, 500),
    ...venueRow({ ...eventVenue(snap.event), name: snap.event.venue_name || snap.event.title, kind }),
    status: 'published',
    data: snap.data,
    summary: snap.summary,
    source: 'event',
    source_event_id: eventId,
    created_by: createdBy || null,
  });
}

/** The Studio's venue type, as one of the library's kinds. */
function kindFromStudio(layout) {
  const t = layout?.venue?.type;
  const map = { arena: 'arena', stadium: 'stadium', theatre: 'theatre', theater: 'theatre', hall: 'concert_hall', concert_hall: 'concert_hall', ballroom: 'ballroom', club: 'club', outdoor: 'outdoor', conference: 'conference' };
  return map[t] || 'other';
}

/**
 * A new Eventsli template (super admin), as a draft. The map comes from an
 * event (`eventId`) or as data read from a picture (`data`); the venue is
 * what the admin chose, else the event's.
 */
async function createPlatform({ eventId = null, data = null, venue: v = {}, name, description, sourceNote, verified, createdBy }) {
  let snap;
  let source;
  if (eventId) {
    snap = await snapshotEvent(eventId);
    source = 'event';
  } else {
    const clean = cleanData(data);
    snap = { event: null, data: clean, summary: summarize(clean) };
    source = 'image';
  }
  const fromEvent = snap.event ? eventVenue(snap.event) : {};
  const chosen = venueRow(v);
  const merged = {
    ...venueRow({ ...fromEvent, kind: v.kind !== undefined ? v.kind : kindFromStudio(snap.data.layout) }),
    ...Object.fromEntries(Object.entries(chosen).filter(([, val]) => val !== null)),
  };
  return insert({
    scope: 'platform',
    organizer_id: null,
    name: layoutName(name, 'Main layout'),
    description: text(description, 500),
    ...merged,
    status: 'draft',
    verified: verified === true,
    data: snap.data,
    summary: snap.summary,
    source,
    source_note: text(sourceNote, 300),
    source_event_id: eventId || null,
    created_by: createdBy || null,
  });
}

/** A new map for an Eventsli template, from an event or picture data (admin). */
// `edited` (2026-11-24): the map was changed in the Venue Builder itself, so
// where it came from — an event, a picture — stays as it was.
async function replaceMap(id, { eventId = null, data = null, edited = false }) {
  const t = await getAny(id);
  if (t.scope !== 'platform') throw fail('NOT_FOUND', 'That map does not exist.');
  let clean;
  if (eventId) clean = (await snapshotEvent(eventId)).data;
  else clean = cleanData(data);
  const { data: row, error } = await supabase.from(TABLE).update({
    data: clean,
    summary: summarize(clean),
    ...(edited && !eventId ? {} : { source: eventId ? 'event' : 'image', source_event_id: eventId || null }),
    updated_at: new Date().toISOString(),
  }).eq('id', id).select(CARD).single();
  check(error, 'replace');
  return card(row);
}

/** A copy of a template into an organizer's library (Eventsli's or their own). */
async function copyToOrganizer(organizerId, id, name, createdBy) {
  const source = await getForOrganizer(organizerId, id);
  await roomFor(organizerId);
  return insert({
    scope: 'organizer',
    organizer_id: organizerId,
    name: layoutName(name, `${source.name}`.slice(0, 73) + (source.scope === 'organizer' ? ' (copy)' : '')),
    description: source.description,
    ...venueRow(source.venue),
    status: 'published',
    data: source.data,
    summary: source.summary,
    source: 'template',
    source_note: source.sourceNote,
    copied_from_id: source.id,
    created_by: createdBy || null,
  });
}

/** An organizer's map copied into Eventsli's library, as a draft (admin). */
async function promoteToPlatform(id, createdBy) {
  const source = await getAny(id);
  return insert({
    scope: 'platform',
    organizer_id: null,
    name: source.name,
    description: source.description,
    ...venueRow(source.venue),
    status: 'draft',
    data: source.data,
    summary: source.summary,
    source: 'template',
    source_note: source.sourceNote,
    copied_from_id: source.id,
    created_by: createdBy || null,
  });
}

/**
 * Renames and the like. An organizer changes their own map's name, notes and
 * venue kind; a super admin changes everything about Eventsli's, including
 * the venue and who sees it.
 */
async function update(id, patch, { organizerId = null, admin = false } = {}) {
  const row = {};
  if (patch.name !== undefined) {
    const name = text(patch.name, 80);
    if (!name || name.length < 2) throw fail('VALIDATION_ERROR', 'Give the map a name of at least two characters.');
    row.name = name;
  }
  if (patch.description !== undefined) row.description = text(patch.description, 500);
  if (patch.venueKind !== undefined) {
    if (!KINDS.includes(patch.venueKind)) throw fail('VALIDATION_ERROR', 'Unknown kind of venue.');
    row.venue_kind = patch.venueKind;
  }
  if (admin) {
    if (patch.venue !== undefined) {
      const v = venueRow(patch.venue || {});
      if (!v.venue_name || v.venue_name.length < 2) throw fail('VALIDATION_ERROR', 'Name the venue this map belongs to.');
      Object.assign(row, v);
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw fail('VALIDATION_ERROR', 'Unknown status.');
      row.status = patch.status;
    }
    if (patch.featured !== undefined) row.featured = patch.featured === true;
    if (patch.verified !== undefined) row.verified = patch.verified === true;
    if (patch.sortOrder !== undefined) row.sort_order = Math.max(0, Math.min(9999, Math.round(Number(patch.sortOrder) || 0)));
    if (patch.sourceNote !== undefined) row.source_note = text(patch.sourceNote, 300);
  }
  if (Object.keys(row).length === 0) throw fail('VALIDATION_ERROR', 'Nothing to change.');
  row.updated_at = new Date().toISOString();

  let q = supabase.from(TABLE).update(row).eq('id', id);
  q = admin ? q.eq('scope', 'platform') : q.eq('scope', 'organizer').eq('organizer_id', organizerId);
  const { data, error } = await q.select(CARD).maybeSingle();
  check(error, 'update');
  if (!data) throw fail('NOT_FOUND', 'That map does not exist.');
  return card(data);
}

async function remove(id, { organizerId = null, admin = false } = {}) {
  let q = supabase.from(TABLE).delete().eq('id', id);
  if (!admin) q = q.eq('scope', 'organizer').eq('organizer_id', organizerId);
  const { data, error } = await q.select('id');
  check(error, 'delete');
  if (!data || data.length === 0) throw fail('NOT_FOUND', 'That map does not exist.');
  return { deleted: true };
}

/** A map put into a Venue Builder: counted, if this organizer may see it. */
async function markUsed(organizerId, id) {
  await getForOrganizer(organizerId, id);
  const { error } = await supabase.rpc('bump_venue_map_template_use', { p_id: id });
  if (error && !missingTable(error)) throw new Error(`venue maps: use count failed: ${error.message}`);
  return { counted: true };
}

module.exports = {
  cleanData, summarize, roomLayout, snapshotEvent, sameVenue, listForOrganizer, getForOrganizer, getAny,
  listForAdmin, eventsAtVenue, saveFromEvent, createPlatform, replaceMap, copyToOrganizer, promoteToPlatform,
  update, remove, markUsed, VenueMapError, MAX_PER_ORGANIZER, KINDS,
};
