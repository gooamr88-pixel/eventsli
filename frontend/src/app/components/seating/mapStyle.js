/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How a map LOOKS — the organizer's colours, borders and themes (2026-11-18).
 *
 * Three things, all in `venue_maps.layout_json`, none of them stock:
 *
 *   layout.tableStyles = { "<table label, lower case>": { sides, fill,
 *                          labelColor, stroke, strokeWidth, radius, seatColor,
 *                          scale } }
 *   layout.look        = { preset, floor, wall, table, label, seat, font }
 *   zone fields        = shape, fill, fillOpacity, strokeWidth, strokeStyle,
 *                        sublabel, textSize, showIcon, textColor (layoutZones.js)
 *
 * WHY TABLE STYLES ARE KEYED BY LABEL. A table's row in `tables` is stock and
 * its columns are the database's; a colour is not worth a migration and a
 * change to `save_venue_map`. The label is unique per map (the API keeps it
 * so, case-insensitively), new tables have it before they have an id, and the
 * editor writes the whole blob on every save — so a renamed table is simply
 * written under its new name.
 *
 * Reading is defensive and writing is strict, as in layoutZones.js: anything
 * that is not a colour, a number in range or a known word is dropped, so a
 * hand-edited blob loses a colour, never the map.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

/** A colour in the one form the map stores: `#rrggbb`, or null. */
export function cleanHex(value) {
  const raw = String(value ?? '').trim();
  if (HEX.test(raw)) return raw.toLowerCase();
  if (SHORT_HEX.test(raw)) return `#${raw.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  return null;
}

function num(value, lo, hi) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

/* ── tables ─────────────────────────────────────────────────────────────── */

const SIDE_KEYS = ['top', 'right', 'bottom', 'left'];

/** One table's style, cleaned. Absent keys mean "the default"; an empty style
 *  is null, so an unstyled table costs nothing in the blob. */
export function cleanTableStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (raw.sides && typeof raw.sides === 'object') {
    const sides = {};
    for (const k of SIDE_KEYS) {
      const v = num(raw.sides[k], 0, 60);
      if (v !== null) sides[k] = Math.round(v);
    }
    if (Object.keys(sides).length) out.sides = sides;
  }
  for (const k of ['fill', 'labelColor', 'stroke', 'seatColor']) {
    const c = cleanHex(raw[k]);
    if (c) out[k] = c;
  }
  const sw = num(raw.strokeWidth, 0, 8);
  if (sw !== null) out.strokeWidth = sw;
  const radius = num(raw.radius, 0, 26);
  if (radius !== null) out.radius = Math.round(radius);
  // The table's drawn size (seatingGeometry.tableScale). 1 is the default and
  // is left out, so resetting the size leaves no trace in the blob.
  const scale = num(raw.scale, 0.5, 1.5);
  if (scale !== null && Math.round(scale * 100) !== 100) out.scale = Math.round(scale * 100) / 100;
  return Object.keys(out).length ? out : null;
}

/** The styles in a layout, by lower-cased label. */
export function readTableStyles(layout) {
  const raw = layout && typeof layout === 'object' ? layout.tableStyles : null;
  const out = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [label, style] of Object.entries(raw)) {
    const clean = cleanTableStyle(style);
    if (clean) out.set(String(label).trim().toLowerCase(), clean);
  }
  return out;
}

/**
 * Tables with their saved style attached as `table.style`. A table that
 * already carries a style (the editor's draft, its preview) keeps its own:
 * the draft is newer than any saved blob.
 */
export function withTableStyles(tables, layout) {
  const styles = readTableStyles(layout);
  if (styles.size === 0) return tables;
  return (tables || []).map((t) => {
    if (t.style !== undefined) return t;
    const style = styles.get(String(t.label ?? '').trim().toLowerCase());
    return style ? { ...t, style } : t;
  });
}

/** The layout blob with these tables' styles in it (replacing the key). */
export function writeTableStyles(layout, tables) {
  const out = { ...(layout && typeof layout === 'object' ? layout : {}) };
  const styles = {};
  for (const t of tables || []) {
    const clean = cleanTableStyle(t.style);
    const label = String(t.label ?? '').trim().toLowerCase();
    if (clean && label) styles[label] = clean;
  }
  if (Object.keys(styles).length) out.tableStyles = styles;
  else delete out.tableStyles;
  return out;
}

/* ── the whole map's look ───────────────────────────────────────────────── */

export const LOOK_FONTS = Object.freeze(['sans', 'bold', 'serif']);
const LOOK_COLOURS = ['floor', 'wall', 'table', 'label', 'seat', 'accent'];

/**
 * The ready-made looks. `cream` is the owner's reference floor plan: cream
 * floor, slate walls, grey tables, pink and teal seats (the second seat colour
 * shows through ticket types; the look's own seat colour is the first).
 */
export const LOOK_PRESETS = Object.freeze([
  { id: 'cream', name: 'Cream classic', floor: '#fffcf2', wall: '#0e3a4a', table: '#8c8c8c', label: '#10303d', seat: '#d6006e', accent: '#00949a', font: 'bold' },
  { id: 'gala', name: 'Night gala', floor: '#16141d', wall: '#ffcc00', table: '#3b3747', label: '#f5f1e8', seat: '#ffcc00', accent: '#ff414b', font: 'bold' },
  { id: 'garden', name: 'Garden', floor: '#f3f7ec', wall: '#3b6d11', table: '#c9b48a', label: '#2d3b17', seat: '#d85a30', accent: '#3b6d11', font: 'sans' },
  { id: 'eventsli', name: 'Eventsli', floor: '#ffffff', wall: '#111018', table: '#eaeaea', label: '#111018', seat: '#ff414b', accent: '#ffcc00', font: 'sans' },
]);

/** A look, cleaned; null when nothing in it is set (the map's plain default). */
export function cleanLook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of LOOK_COLOURS) {
    const c = cleanHex(raw[k]);
    if (c) out[k] = c;
  }
  if (LOOK_FONTS.includes(raw.font)) out.font = raw.font;
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 40);
  return Object.keys(out).length ? out : null;
}

export function readLook(layout) {
  return cleanLook(layout && typeof layout === 'object' ? layout.look : null);
}

export function writeLook(layout, look) {
  const out = { ...(layout && typeof layout === 'object' ? layout : {}) };
  const clean = cleanLook(look);
  if (clean) out.look = clean; else delete out.look;
  return out;
}

/** A preset as a look (its id kept as the name the panel shows). */
export function presetLook(preset) {
  return cleanLook({ ...preset, name: preset.name });
}

/** The font family and weight a look's labels are drawn in. */
export function lookFont(look) {
  switch (look?.font) {
    case 'serif': return { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 600 };
    case 'bold': return { fontFamily: 'var(--es-font-display)', fontWeight: 800 };
    default: return { fontFamily: undefined, fontWeight: 500 };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MAP'S COLOUR RULES (owner, 2026-11-24: "all chairs surrounding tables
 * must always remain black; tables must display their correct assigned
 * colours"). One rule, read by every view — the buyer's map, the editor, the
 * door map, the previews and the 3D room — so they can no longer disagree:
 *
 *   A TABLE is painted in, first to last:
 *     1. its own colour (Appearance › Table colour),
 *     2. its CATEGORY's colour (the event's table categories),
 *     3. its TICKET TYPE's colour, when the map sells more than one type
 *        (the colour the ticket categories beside the map show),
 *     4. the map look's table colour,
 *     5. the plain surface.
 *   Before this the editor painted (1, 2, 4) and the buyer's map (1, 4): the
 *   category colours an organizer chose never reached a buyer, and a table's
 *   ticket type showed only on its chairs, in a different colour per view.
 *
 *   A CHAIR AT A TABLE is always black (`CHAIR`). Its state is said by how it
 *   is drawn, never by recolouring it: selected = a coral ring, unavailable or
 *   private = faded. A thin light edge keeps a black chair visible on a dark
 *   floor.
 *
 *   A SEAT IN A ROW (no table body: theatre rows, sections) has no table to
 *   carry the colour, so the seat does: its own seat colour, then the
 *   category's or ticket type's, then the look's seat colour.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const CHAIR = '#111018';
/** The light edge round every chair, so black reads on a dark floor too. */
export const CHAIR_EDGE = '#ffffff';
/** How faded an unavailable (or still locked) chair is drawn. */
export const CHAIR_FADED_OPACITY = 0.28;

/**
 * What a table is painted in: its own style first, then `fallback.fill` (its
 * category's or ticket type's colour — `tableTint` in venueModel.js), then the
 * map's look. See THE MAP'S COLOUR RULES above.
 */
export function tablePaint(table, look, fallback = {}) {
  const s = table?.style || {};
  const assigned = s.fill || cleanHex(fallback.fill) || null;
  return {
    fill: assigned || look?.table || null,
    stroke: s.stroke || null,
    strokeWidth: s.strokeWidth ?? null,
    // An assigned colour gets a name readable on it; the look's own table
    // colour keeps the look's label colour.
    label: s.labelColor || (assigned ? inkOn(assigned) : look?.label) || null,
    seat: s.seatColor || null,
    // The category's or ticket type's colour, for a row's seats (no body).
    tint: cleanHex(fallback.fill) || null,
  };
}

/** Black or white, whichever reads on this fill — for a label nobody coloured. */
export function inkOn(hex) {
  const c = cleanHex(hex);
  if (!c) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111018' : '#ffffff';
}

/* ── zones ──────────────────────────────────────────────────────────────── */

export const ZONE_SHAPES = Object.freeze(['rect', 'rounded', 'ellipse', 'pill', 'd', 'rings']);
export const STROKE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'none']);
export const TEXT_SIZES = Object.freeze(['s', 'm', 'l']);

/** The style keys a zone may carry, cleaned. Spread into the stored zone. */
export function cleanZoneStyle(z) {
  const out = {};
  if (ZONE_SHAPES.includes(z?.shape)) out.shape = z.shape;
  const fill = cleanHex(z?.fill);
  if (fill) out.fill = fill;
  const fo = num(z?.fillOpacity, 0, 1);
  if (fo !== null) out.fillOpacity = Math.round(fo * 100) / 100;
  const sw = num(z?.strokeWidth, 0, 12);
  if (sw !== null) out.strokeWidth = sw;
  if (STROKE_STYLES.includes(z?.strokeStyle)) out.strokeStyle = z.strokeStyle;
  if (typeof z?.sublabel === 'string' && z.sublabel.trim()) out.sublabel = z.sublabel.trim().slice(0, 60);
  if (TEXT_SIZES.includes(z?.textSize)) out.textSize = z.textSize;
  if (typeof z?.showIcon === 'boolean') out.showIcon = z.showIcon;
  if (z?.showLabel === false) out.showLabel = false;
  const tc = cleanHex(z?.textColor);
  if (tc) out.textColor = tc;
  return out;
}

/** True when the organizer has styled this zone at all — the buyer's map then
 *  draws it as they designed it rather than in its stock showcase look. */
export function isStyledZone(z) {
  return Object.keys(cleanZoneStyle(z)).length > 0;
}
