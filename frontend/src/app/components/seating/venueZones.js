/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Venue zones — the parts of a room that are NOT stock.
 *
 * A stage, a bar, a dance floor. An organizer cannot lay out a room without
 * them: a table map with no stage does not tell anybody which seats face the
 * thing they came to see, and that is the first question a buyer asks.
 *
 *
 * WHY THESE ARE NOT ROWS IN `tables`
 *
 * Because `tables` is stock. Every row there gets `seat_count` seats generated
 * against it, and those seats are what holds, orders and tickets point at. A
 * dance floor with ten seats behind it is not a drawing mistake, it is ten
 * sellable chairs that do not exist, and somebody will buy one.
 *
 * So zones live in `venue_maps.layout_json`, which `save_venue_map` already
 * writes verbatim and `getMapForOrganizer` already returns untouched. That is
 * the whole integration: no migration, no new endpoint, and no possibility of a
 * zone ever becoming a ticket.
 *
 *
 * ONE CATALOGUE, THREE CONSUMERS
 *
 * The editor, the buyer's map and the printed pack all read from here, for the
 * same reason `seatingGeometry.js` exists and says so at length: in the
 * codebase this pattern came from the catalogue was hand-copied into three
 * files, the copies drifted, and a guest opening their seating chart saw the
 * buffet drawn as a round TABLE. A missing entry must not fall through to
 * something drawable-but-wrong, so `zoneMeta` falls back to `custom` — a
 * neutral box that reads as "an area", which is true of anything here.
 *
 * Adding a zone means editing this file and `zoneIcons.js`. Nothing else.
 * `venueZones.test.js` fails if a kind has no icon, or if an icon has no kind.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Sizes are in WORLD UNITS — the same 1000×700 surface `seatingGeometry.WORLD`
 * defines and tables are drawn on. Not pixels, and deliberately not a second
 * coordinate system: a zone and a table have to be comparable at a glance or
 * the map lies about the room. For scale, a 10-seat round table comes out
 * around 52 units across, so the stage below is about three tables wide.
 *
 * `color` is the zone's ink: its outline, its icon and its label. The fill is
 * the same hue at low alpha, mixed at draw time rather than stored, so a zone
 * never needs two colours kept in step.
 *
 * Every colour here is deliberately muted — these sit UNDER the map, behind the
 * seats, which are the only thing anyone is actually choosing between. A
 * saturated dance floor competes with the stock for attention and wins.
 */
export const ZONES = Object.freeze({
  stage:        { label: 'Stage',        w: 144, h: 60,  icon: 'mic',        color: '#3f5175' },
  dance_floor:  { label: 'Dance floor',  w: 112, h: 112, icon: 'disco',      color: '#5a5580' },
  bar:          { label: 'Bar',          w: 96,  h: 38,  icon: 'cocktail',   color: '#7a5a48' },
  dj_booth:     { label: 'DJ booth',     w: 54,  h: 46,  icon: 'headphones', color: '#35597f' },
  entrance:     { label: 'Entrance',     w: 60,  h: 28,  icon: 'door',       color: '#46705a' },
  restroom:     { label: 'Restrooms',    w: 48,  h: 40,  icon: 'restroom',   color: '#3f6d76' },
  coat_check:   { label: 'Coat check',   w: 60,  h: 36,  icon: 'coat',       color: '#64564a' },
  gift_table:   { label: 'Gift table',   w: 60,  h: 36,  icon: 'gift',       color: '#8a5568' },
  cake_table:   { label: 'Cake table',   w: 52,  h: 40,  icon: 'cake',       color: '#8a6070' },
  photo_booth:  { label: 'Photo booth',  w: 68,  h: 52,  icon: 'camera',     color: '#45658f' },
  welcome_desk: { label: 'Welcome desk', w: 68,  h: 34,  icon: 'clipboard',  color: '#4f6b54' },
  buffet:       { label: 'Buffet',       w: 88,  h: 36,  icon: 'buffet',     color: '#86603a' },
  lounge:       { label: 'Lounge',       w: 88,  h: 64,  icon: 'sofa',       color: '#6a5f85' },
  custom:       { label: 'Custom area',  w: 76,  h: 52,  icon: 'area',       color: '#2c62bd' },
});

/** The catalogue in the order the Add dialog offers it. Insertion order of a
 *  frozen literal is stable, so this is that order, named. */
export const ZONE_KINDS = Object.freeze(Object.keys(ZONES));

export const DEFAULT_ZONE_KIND = 'custom';

/**
 * Catalogue entry for a stored kind.
 *
 * NEVER index `ZONES[kind]` directly. An unrecognised kind — a zone written by
 * a newer version of the editor, or a hand-edited layout blob — returns
 * undefined and throws on the next property access, which takes the whole map
 * down rather than losing one rectangle.
 */
export function zoneMeta(kind) {
  return ZONES[kind] || ZONES[DEFAULT_ZONE_KIND];
}

/** The smallest a zone may be dragged. Below this the label and icon have
 *  nowhere to go and the handle covers the whole shape, so it cannot be
 *  grabbed again to undo the mistake. */
export const MIN_ZONE_SIZE = 24;

/** A room can hold a lot of furniture, but not unbounded furniture: the layout
 *  blob is one JSONB column read on every map load, including the buyer's. */
export const MAX_ZONES = 120;

/**
 * A zone's box in world units.
 *
 * `x`/`y` are the CENTRE, as a percentage of the world — matching `toWorld` and
 * every table position, because the alternative is the bug `seatingGeometry`
 * documents: one surface reading a corner where another wrote a centre, and the
 * layout not shifting but SCATTERING, since each element moves by half of its
 * own differing size.
 */
export function zoneBox(zone, world) {
  const meta = zoneMeta(zone.kind);
  const w = positive(zone.w, meta.w);
  const h = positive(zone.h, meta.h);
  const cx = (Number(zone.x) || 0) / 100 * world.width;
  const cy = (Number(zone.y) || 0) / 100 * world.height;
  return {
    cx, cy, w, h,
    x: cx - w / 2,
    y: cy - h / 2,
    right: cx + w / 2,
    bottom: cy + h / 2,
    rotation: Number(zone.rotation) || 0,
  };
}

/** A zone's own colour, or its kind's. Stored per zone so "Bar 1" and "Bar 2"
 *  can be told apart when an organizer wants that, without forking the kind. */
export function zoneColor(zone) {
  const raw = String(zone?.color || '').trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw) ? raw : zoneMeta(zone?.kind).color;
}

/**
 * THE COLOUR A ZONE'S LABEL AND ICON ARE DRAWN IN — readable on the zone itself.
 *
 * The label was drawn in the zone colour on a wash of that same colour (12%, or
 * 20% selected). Ten of the fourteen kinds measured 3.68–4.23:1 against their own
 * wash, under the 4.5:1 WCAG asks of text this size, and a custom colour can be
 * anything an organizer picks. So the ink is the zone colour pulled toward black
 * until it clears 4.5:1 against both washes, on both map grounds: the hue stays,
 * the fill and outline stay as drawn, and only the words get darker.
 */
const ZONE_GROUNDS = ['#ffffff', '#eff3fa'];   // the map on a surface, and on bg-sunken
export function zoneInk(color) {
  const rgb = expandHex(color);
  if (!rgb) return color;
  const washes = ZONE_GROUNDS.flatMap((g) => [mixRgb(rgb, 0.12, expandHex(g)), mixRgb(rgb, 0.2, expandHex(g))]);
  for (let k = 0.8; k >= 0; k -= 0.05) {
    const ink = rgb.map((v) => Math.round(v * k));
    if (washes.every((w) => contrast(ink, w) >= 4.5)) return toHex(ink);
  }
  return '#000000';
}

function expandHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function mixRgb(a, p, b) { return a.map((v, i) => Math.round(v * p + b[i] * (1 - p))); }
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function toHex(rgb) { return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`; }

/**
 * The label a zone shows when it has none of its own.
 *
 * Falls back to the KIND's label rather than to empty. An unlabelled rectangle
 * on a floor plan is worse than useless at the door — staff cannot ask about it
 * and cannot route anybody to it.
 */
export function zoneLabel(zone) {
  const own = String(zone?.label || '').trim();
  return own || zoneMeta(zone?.kind).label;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_ZONE_SIZE ? n : fallback;
}
