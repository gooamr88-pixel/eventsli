const { publicUrl } = require('./mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Venue Studio's part of `venue_maps.layout_json`.
 *
 * The map API round-trips the layout blob verbatim, and until the studio that
 * was safe: zones are numbers and short labels, which React prints as text.
 * The studio adds IMAGES to it (the venue's photo, and 360° panoramas), and an
 * image URL is different. It is loaded on the buyer's public page, so a blob
 * that carries one is a link the platform vouches for, and the blob is written
 * by a client.
 *
 * So the rule from mediaService applies here too: THE CLIENT SENDS A PATH,
 * NEVER A URL. Each path must be an object this event's upload step could have
 * created (`events/<eventId>/venue-…` or `…/panorama-…`), and the URL stored
 * beside it is computed from that path, here, on every save. A URL arriving from
 * the client is discarded without being read.
 *
 * Everything else in the studio's keys (`venue`, `scene`, `sections`, and the
 * venue size `world`) is plain text and numbers, clamped to sizes the
 * renderers draw. Keys this file does not
 * know about pass through untouched, as they always have: the save is a full
 * replace, and an older server must not strip what a newer editor wrote.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The whole blob, serialised. Every buyer's map load reads it. */
const MAX_LAYOUT_BYTES = 256 * 1024;
const MAX_VIEWS = 24;
const MAX_SECTIONS = 200;
const VIEW_KINDS = Object.freeze(['seat', 'stage', 'upper', 'entrance', 'other']);
const ACCESS_FEATURES = Object.freeze(['wheelchair', 'step_free', 'hearing_loop', 'accessible_restroom', 'companion']);
const VENUE_TYPES = Object.freeze(['arena', 'theatre', 'ballroom', 'club', 'outdoor', 'conference']);
/**
 * The map's world — the size every stored percentage is resolved against.
 * Mirrors `seatingGeometry.WORLD` and `MAX_WORLD` on the frontend (a frontend
 * test reads this file and holds the numbers equal). The default is the size of
 * every map saved before worlds were per map; the maximum is a stadium bowl.
 */
const DEFAULT_WORLD = Object.freeze({ width: 1000, height: 700 });
const MAX_WORLD = Object.freeze({ width: 10000, height: 10000 });

class StudioError extends Error {
  constructor(message) {
    super(message);
    this.code = 'VALIDATION_ERROR';
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** True when `path` is an object the studio's upload step signs for THIS event. */
function ownPath(eventId, path, kinds) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `events/${eventId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return new RegExp(`^(${kinds.join('|')})-[0-9a-f]{16}\\.(jpg|png|webp)$`).test(name);
}

function image(eventId, raw, kinds) {
  if (!raw || !ownPath(eventId, raw.path, kinds)) return null;
  return { path: raw.path, url: publicUrl(raw.path) };
}

function cleanVenue(eventId, raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    name: text(raw.name, 120),
    type: VENUE_TYPES.includes(raw.type) ? raw.type : 'arena',
    standingCapacity: Math.round(num(raw.standingCapacity, 0, 200000, 0)),
    access: Array.isArray(raw.access) ? ACCESS_FEATURES.filter((k) => raw.access.includes(k)) : [],
    notes: text(raw.notes, 600),
    photo: image(eventId, raw.photo, ['venue']),
  };
}

function cleanViews(eventId, raw) {
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (out.length >= MAX_VIEWS) break;
    const img = image(eventId, v, ['panorama']);
    if (!img) continue;
    const id = text(v.id, 40) || img.path.slice(-26, -4);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      ...img,
      name: text(v.name, 60) || 'View',
      kind: VIEW_KINDS.includes(v.kind) ? v.kind : 'other',
      // Table labels this view is taken from. Labels, not ids: a new table has
      // no id until the save that this blob travels with.
      tables: Array.isArray(v.tables)
        ? [...new Set(v.tables.map((t) => text(t, 60)).filter(Boolean))].slice(0, 400)
        : [],
      heading: num(v.heading, -180, 180, 0),
    });
  }
  return out;
}

function cleanSections(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, MAX_SECTIONS).filter((s) => s && typeof s === 'object').map((s) => ({
    id: text(s.id, 40),
    name: text(s.name, 40),
    rows: Array.isArray(s.rows)
      ? s.rows.slice(0, 60).map((r) => ({ table: text(r?.table, 60), row: text(r?.row, 8) })).filter((r) => r.table)
      : [],
  })).filter((s) => s.id && s.name);
}

function cleanScene(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    rake: num(raw.rake, 0, 40, 12),
    stageHeight: num(raw.stageHeight, 0, 4, 1.2),
    mood: ['concert', 'daylight', 'gala'].includes(raw.mood) ? raw.mood : 'concert',
    screens: raw.screens !== false,
    roof: raw.roof !== false,
  };
}

/**
 * Whole units between the default world and the maximum, or undefined (the key
 * is dropped, and the map draws in the default world) when it is unreadable.
 * Positions are percentages, so this never moves a seat: it only says how big
 * the floor they are percentages of is, and the editor sends tables moved to
 * match in the same save.
 */
function cleanWorld(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = Number(raw.width);
  const h = Number(raw.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return {
    width: Math.round(Math.min(MAX_WORLD.width, Math.max(DEFAULT_WORLD.width, w))),
    height: Math.round(Math.min(MAX_WORLD.height, Math.max(DEFAULT_WORLD.height, h))),
  };
}

/**
 * The layout as it will be stored. Throws a VALIDATION_ERROR only for a blob
 * too large to serve; anything malformed inside the studio's keys is dropped
 * rather than refused, the same contract `layoutZones.readZones` keeps.
 */
function sanitizeLayout(eventId, layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {};
  const out = { ...layout };
  const set = (key, value) => { if (value === undefined) delete out[key]; else out[key] = value; };
  if ('venue' in layout) set('venue', cleanVenue(eventId, layout.venue));
  if ('views' in layout) set('views', cleanViews(eventId, layout.views));
  if ('sections' in layout) set('sections', cleanSections(layout.sections));
  if ('scene' in layout) set('scene', cleanScene(layout.scene));
  if ('world' in layout) set('world', cleanWorld(layout.world));

  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_LAYOUT_BYTES) {
    throw new StudioError('This venue layout is too large to save. Remove some areas or views and try again.');
  }
  return out;
}

module.exports = {
  sanitizeLayout, ownPath, MAX_LAYOUT_BYTES, MAX_VIEWS, VIEW_KINDS, ACCESS_FEATURES, VENUE_TYPES,
  DEFAULT_WORLD, MAX_WORLD,
};
