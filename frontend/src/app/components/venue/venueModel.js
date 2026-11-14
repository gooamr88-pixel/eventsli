/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Venue Studio's keys in `venue_maps.layout_json`. ONE reader, one writer.
 *
 *   layout = {
 *     world, zones,                       // layoutZones.js, unchanged
 *     venue:    { name, type, standingCapacity, access: [...], notes, photo: { path, url } },
 *     scene:    { rake, stageHeight, mood, screens, roof },   // the 3D view
 *     views:    [ { id, path, url, name, kind, tables: [label…], heading } ],  // 360° photos
 *     sections: [ { id, name, rows: [ { table: label, row } ] } ],
 *   }
 *
 * The same contract as `layoutZones`: READING IS DEFENSIVE AND WRITING IS
 * STRICT. The blob has no schema behind it, and this is read on the buyer's
 * page, so anything malformed is dropped here rather than reaching a renderer.
 * The server repeats the cleaning (backend/services/venueStudio.js) and is the
 * one that decides image URLs; this file never builds one.
 *
 * WHY SECTIONS POINT AT TABLES BY LABEL. A stadium section is rows, and a row
 * is a `tables` row of shape 'row' (stock). The section is how a buyer reads
 * it — "Section A1 · Row H · Seat 17" — and it has to travel in the same save
 * as the tables it names, when a new table has no id yet. Labels are already
 * unique per map and are what seats' `section_key` follows, so they are the
 * key the rest of the system uses too. A table renamed by hand simply falls
 * out of its section and is named by its own label again: degraded, not broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const VENUE_TYPES = Object.freeze([
  { key: 'arena', label: 'Arena or stadium' },
  { key: 'theatre', label: 'Theatre or concert hall' },
  { key: 'ballroom', label: 'Ballroom or banquet hall' },
  { key: 'club', label: 'Club or live room' },
  { key: 'outdoor', label: 'Open air' },
  { key: 'conference', label: 'Conference room' },
]);

export const ACCESS_FEATURES = Object.freeze([
  { key: 'wheelchair', label: 'Wheelchair spaces' },
  { key: 'step_free', label: 'Step-free access' },
  { key: 'hearing_loop', label: 'Hearing loop' },
  { key: 'accessible_restroom', label: 'Accessible restrooms' },
  { key: 'companion', label: 'Companion seats' },
]);

export const VIEW_KINDS = Object.freeze([
  { key: 'seat', label: 'Seat view' },
  { key: 'stage', label: 'Stage view' },
  { key: 'upper', label: 'Upper level' },
  { key: 'entrance', label: 'Entrance' },
  { key: 'other', label: 'Other' },
]);

export const MOODS = Object.freeze([
  { key: 'concert', label: 'Concert', hint: 'Dark room, stage lights' },
  { key: 'gala', label: 'Gala', hint: 'Warm, low light' },
  { key: 'daylight', label: 'Daylight', hint: 'Bright and even' },
]);

export const DEFAULT_SCENE = Object.freeze({
  rake: 12, stageHeight: 1.2, mood: 'concert', screens: true, roof: true,
});

export const MAX_VIEWS = 24;

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const hasKey = (list, key) => list.some((x) => x.key === key);

function readImage(raw) {
  if (!raw || typeof raw.path !== 'string' || typeof raw.url !== 'string') return null;
  // Only an http(s) URL is ever drawn. The server writes these; a hand-edited
  // blob with `javascript:` in it should lose its picture, nothing more.
  if (!/^https?:\/\//i.test(raw.url)) return null;
  return { path: raw.path, url: raw.url };
}

/** The studio's part of a layout, always complete and always drawable. */
export function readStudio(layout) {
  const v = layout?.venue && typeof layout.venue === 'object' ? layout.venue : {};
  const s = layout?.scene && typeof layout.scene === 'object' ? layout.scene : {};
  return {
    venue: {
      name: text(v.name, 120),
      type: hasKey(VENUE_TYPES, v.type) ? v.type : 'arena',
      standingCapacity: Math.round(num(v.standingCapacity, 0, 200000, 0)),
      access: Array.isArray(v.access) ? ACCESS_FEATURES.map((a) => a.key).filter((k) => v.access.includes(k)) : [],
      notes: text(v.notes, 600),
      photo: readImage(v.photo),
    },
    scene: {
      rake: num(s.rake, 0, 40, DEFAULT_SCENE.rake),
      stageHeight: num(s.stageHeight, 0, 4, DEFAULT_SCENE.stageHeight),
      mood: hasKey(MOODS, s.mood) ? s.mood : DEFAULT_SCENE.mood,
      screens: s.screens !== false,
      roof: s.roof !== false,
    },
    views: readViews(layout?.views),
    sections: readSections(layout?.sections),
  };
}

function readViews(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (out.length >= MAX_VIEWS) break;
    const img = readImage(v);
    if (!img || typeof v.id !== 'string' || !v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({
      id: v.id,
      ...img,
      name: text(v.name, 60) || 'View',
      kind: hasKey(VIEW_KINDS, v.kind) ? v.kind : 'other',
      tables: Array.isArray(v.tables) ? v.tables.filter((t) => typeof t === 'string').slice(0, 400) : [],
      heading: num(v.heading, -180, 180, 0),
      spot: readSpot(v.spot),
    });
  }
  return out;
}

/** Where a 360° photo was taken (map %, camera height in m), or null. */
function readSpot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: num(x, 0, 100, 50), y: num(y, 0, 100, 50), h: num(raw.h, 0.3, 6, 1.5) };
}

function readSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.name)
    .map((s) => ({
      id: s.id,
      name: s.name.slice(0, 40),
      rows: Array.isArray(s.rows)
        ? s.rows.filter((r) => r && typeof r.table === 'string').map((r) => ({ table: r.table, row: text(r.row, 8) || r.table }))
        : [],
    }));
}

/**
 * The layout with the studio's keys replaced and every other key kept — the
 * full-replace save must not destroy what this version does not know about.
 */
export function writeStudio(layout, studio) {
  return {
    ...(layout || {}),
    venue: { ...studio.venue, photo: studio.venue.photo ? { path: studio.venue.photo.path, url: studio.venue.photo.url } : null },
    scene: { ...studio.scene },
    views: studio.views.map((v) => ({ ...v, tables: [...v.tables] })),
    sections: studio.sections.map((s) => ({ id: s.id, name: s.name, rows: s.rows.map((r) => ({ ...r })) })),
  };
}

/** Sections that still name at least one table on the map, rows pruned to the live ones. */
export function liveSections(sections, tables) {
  const labels = new Set((tables || []).map((t) => t.label));
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => labels.has(r.table)) }))
    .filter((s) => s.rows.length > 0);
}

/** table label → { section, row }, for naming a seat the way a buyer reads it. */
export function sectionIndex(sections) {
  const map = new Map();
  for (const s of sections || []) {
    for (const r of s.rows) map.set(r.table, { section: s.name, row: r.row });
  }
  return map;
}

/**
 * "Section A1 · Row H · Seat 17", or "Table 4 · Seat 3" for a table that is not
 * part of a section. The one place a seat is named in the studio's views, so the
 * 3D tooltip, the 360° card and the selection all say the same thing.
 */
export function seatName(seat, tableLabel, index) {
  const where = index?.get(tableLabel);
  const number = seat?.number ?? '';
  if (where) return `Section ${where.section} · Row ${where.row} · Seat ${number}`;
  return `${tableLabel ? `Table ${tableLabel} · ` : ''}Seat ${number}`;
}

/**
 * A colour per ticket type, most expensive first: gold, then the brand's teal,
 * then hues far enough apart to tell at seat size. These fill seats (shapes,
 * not text), and every one sits on both the light floor and the dark 3D room.
 */
export const TIER_COLORS = Object.freeze([
  '#e5b22f', '#17a2a6', '#8b6cf0', '#2fa36b', '#e0704f', '#4f7fd9', '#c75a86', '#8a9aa6',
]);

export function tierPalette(tiers, seats) {
  const prices = new Map();
  for (const s of seats || []) {
    if (!s.tierId) continue;
    prices.set(s.tierId, Math.max(prices.get(s.tierId) ?? -1, Number(s.priceCents) || 0));
  }
  const ordered = [...(tiers || [])].sort((a, b) => (prices.get(b.id) ?? b.priceCents ?? 0) - (prices.get(a.id) ?? a.priceCents ?? 0));
  return new Map(ordered.map((t, i) => [t.id, TIER_COLORS[i % TIER_COLORS.length]]));
}

/** Total seats on the map plus the venue's declared standing room. */
export function capacityOf(tables, venue) {
  const seated = (tables || []).reduce((n, t) => n + (Number(t.seatCount) || 0), 0);
  return { seated, standing: venue?.standingCapacity || 0, total: seated + (venue?.standingCapacity || 0) };
}

/** A short random id for a section or view; never a security token. */
export function studioId(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
