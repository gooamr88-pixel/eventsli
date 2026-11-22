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
 * Sizes are in WORLD UNITS — the map's own world (`seatingGeometry.worldOf`, 1000×700 by default)
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
  // Arena and theatre furniture, added with the Venue Studio (2026-11-09).
  // Still scenery: a standing area here sells nothing — it says where the
  // crowd stands, beside seats that are the stock.
  screen:       { label: 'Video screen', w: 96,  h: 26,  icon: 'screen',     color: '#2f4a6b' },
  standing:     { label: 'Standing area', w: 160, h: 110, icon: 'crowd',     color: '#4d6b5f' },
  aisle:        { label: 'Walkway',      w: 140, h: 26,  icon: 'walk',       color: '#5f6670' },
  accessible:   { label: 'Accessible seating', w: 56, h: 40, icon: 'wheelchair', color: '#2f5fa8' },
  barrier:      { label: 'Barrier',      w: 160, h: 24,  icon: 'barrier',    color: '#55595f' },
  custom:       { label: 'Custom area',  w: 76,  h: 52,  icon: 'area',       color: '#0d5b5e' },
  // The room (2026-11-18, the owner's floor-plan reference). A wall is a thin
  // solid bar, drawn corner to corner by the Draw wall tool; a door is a gap
  // painted in the floor's colour over a wall, with its name beside it; text
  // is words on the floor; a decorative feature is a centrepiece in rings.
  // `min` lets these be thinner than MIN_ZONE_SIZE, which they must be.
  wall:         { label: 'Wall',         w: 200, h: 6,   icon: 'wall',       color: '#0e3a4a', min: { w: 8, h: 2 } },
  door_gap:     { label: 'Door',         w: 60,  h: 10,  icon: 'door',       color: '#0e3a4a', min: { w: 12, h: 2 } },
  text:         { label: 'Text label',   w: 150, h: 26,  icon: 'text',       color: '#10303d', min: { w: 20, h: 10 } },
  decor:        { label: 'Decorative feature', w: 96, h: 96, icon: 'decor',  color: '#946e58' },
  // The professional set (2026-11-21, the owner: "add more amazing
  // professional elements"): what conference, concert, festival, fashion and
  // expo floor plans show beyond a gala's — production positions, guest
  // services, safety and the building's own fixtures. Still scenery, all of
  // it: none is ever sold or ticketed.
  podium:       { label: 'Podium',          w: 40,  h: 34,  icon: 'podium',    color: '#3f5175' },
  runway:       { label: 'Runway',          w: 54,  h: 220, icon: 'runway',    color: '#5a5580' },
  backstage:    { label: 'Backstage',       w: 150, h: 70,  icon: 'curtain',   color: '#4a4560' },
  green_room:   { label: 'Green room',      w: 80,  h: 60,  icon: 'star',      color: '#4f6b54' },
  sound_desk:   { label: 'Sound & lights desk', w: 70, h: 44, icon: 'mixer',   color: '#35597f' },
  speaker:      { label: 'Speaker stack',   w: 26,  h: 26,  icon: 'speaker',   color: '#3a3f4a' },
  camera_platform: { label: 'Camera platform', w: 44, h: 40, icon: 'video',    color: '#45658f' },
  box_office:   { label: 'Box office',      w: 72,  h: 36,  icon: 'ticket',    color: '#8a5568' },
  merch:        { label: 'Merch stand',     w: 72,  h: 40,  icon: 'shirt',     color: '#6a5f85' },
  vip_area:     { label: 'VIP area',        w: 130, h: 90,  icon: 'crown',     color: '#8a6a2f' },
  exhibit:      { label: 'Exhibitor stand', w: 60,  h: 60,  icon: 'stand',     color: '#4d6b5f' },
  food_truck:   { label: 'Food truck',      w: 90,  h: 40,  icon: 'truck',     color: '#86603a' },
  coffee:       { label: 'Coffee & tea',    w: 64,  h: 34,  icon: 'cup',       color: '#7a5a48' },
  water:        { label: 'Water station',   w: 40,  h: 32,  icon: 'drop',      color: '#2f6f8f' },
  kitchen:      { label: 'Kitchen',         w: 120, h: 70,  icon: 'chef',      color: '#64564a' },
  info_desk:    { label: 'Information',     w: 56,  h: 36,  icon: 'info',      color: '#2f5fa8' },
  first_aid:    { label: 'First aid',       w: 54,  h: 40,  icon: 'aid',       color: '#a23b3b' },
  security:     { label: 'Security',        w: 54,  h: 36,  icon: 'shield',    color: '#3a4a5f' },
  emergency_exit: { label: 'Emergency exit', w: 60, h: 28,  icon: 'exit',      color: '#2e7d4f' },
  lift:         { label: 'Lift',            w: 40,  h: 40,  icon: 'lift',      color: '#5f6670' },
  stairs:       { label: 'Stairs',          w: 60,  h: 44,  icon: 'stairs',    color: '#5f6670' },
  pillar:       { label: 'Pillar',          w: 22,  h: 22,  icon: 'pillar',    color: '#55595f', min: { w: 10, h: 10 } },
  plants:       { label: 'Plants',          w: 40,  h: 40,  icon: 'plant',     color: '#3f7a4a' },
  kids_area:    { label: 'Kids’ area',      w: 100, h: 80,  icon: 'balloon',   color: '#8a5f9a' },
  charging:     { label: 'Charging point',  w: 40,  h: 32,  icon: 'bolt',      color: '#8a7a2f' },
  smoking:      { label: 'Smoking area',    w: 90,  h: 60,  icon: 'smoke',     color: '#6b6b6b' },
});

/**
 * The Add dialog's groups, in the order a plan is thought through: what
 * happens, who serves whom, what keeps it running, what keeps people safe,
 * and the building itself. Every kind is in exactly one group
 * (`venueZones.test.js` holds that).
 */
export const ZONE_GROUPS = Object.freeze([
  { key: 'show', label: 'Stage & show', kinds: ['stage', 'podium', 'runway', 'screen', 'dance_floor', 'dj_booth', 'backstage', 'green_room'] },
  { key: 'production', label: 'Production', kinds: ['sound_desk', 'speaker', 'camera_platform', 'barrier'] },
  { key: 'food', label: 'Food & drink', kinds: ['bar', 'buffet', 'food_truck', 'coffee', 'water', 'cake_table', 'kitchen'] },
  { key: 'guests', label: 'Guests & services', kinds: ['entrance', 'box_office', 'welcome_desk', 'info_desk', 'coat_check', 'restroom', 'merch', 'photo_booth', 'gift_table', 'lounge', 'vip_area', 'exhibit', 'kids_area', 'charging'] },
  { key: 'safety', label: 'Safety & access', kinds: ['first_aid', 'security', 'emergency_exit', 'accessible', 'lift', 'stairs', 'smoking'] },
  { key: 'space', label: 'Spaces & structure', kinds: ['standing', 'aisle', 'custom', 'pillar', 'plants', 'decor', 'wall', 'door_gap', 'text'] },
]);

/** The kinds that are the room itself rather than furniture in it: drawn
 *  without the furniture's wash, icon or capitals (ZoneShape). */
export const ROOM_KINDS = Object.freeze(new Set(['wall', 'door_gap', 'text']));

/**
 * Zones in the order they are painted: walls first, so a door gap laid over a
 * wall paints the gap whatever order the two were drawn in. Stable otherwise.
 */
export function paintOrder(zones) {
  if (!zones.some((z) => z.kind === 'wall')) return zones;
  return [...zones.filter((z) => z.kind === 'wall'), ...zones.filter((z) => z.kind !== 'wall')];
}

/** How small a zone of this kind may be: MIN_ZONE_SIZE, unless its catalogue
 *  entry says less (a wall is a few units thick). */
export function minZoneSize(kind) {
  const m = zoneMeta(kind).min;
  return { w: m?.w ?? MIN_ZONE_SIZE, h: m?.h ?? MIN_ZONE_SIZE };
}

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
  if (kind === BOOTH_KIND) return BOOTH_META;
  return ZONES[kind] || ZONES[DEFAULT_ZONE_KIND];
}

/**
 * A VENDOR BOOTH on the venue map (2026-11-22, the owner: "merge the seating
 * map of the event and the seating map of vendors"). Deliberately NOT in
 * `ZONES`: a booth is stock — vendors are offered and sold it — and it lives
 * in `vendor_floor_plans`, never in `layout_json`. The editor carries booths
 * as zones of this kind so they move, turn, resize, undo and select exactly
 * like the room around them; the save splits them back out (boothZones.js).
 * `readZones` drops the kind and `writeZones` skips it, so a booth can never
 * land in the seat map's blob or reach the AI's catalogue.
 *
 * Sized 3 m × 3 m — the standard expo booth — in world units.
 */
export const BOOTH_KIND = 'booth';
export const BOOTH_META = Object.freeze({
  label: 'Vendor booth', w: 131, h: 131, icon: 'stand', color: '#4d6b5f', min: { w: 8, h: 8 },
});

/** The smallest a zone may be dragged. Below this the label and icon have
 *  nowhere to go and the handle covers the whole shape, so it cannot be
 *  grabbed again to undo the mistake. */
export const MIN_ZONE_SIZE = 24;

/** A room can hold a lot of furniture, but not unbounded furniture: the layout
 *  blob is one JSONB column read on every map load, including the buyer's. */
export const MAX_ZONES = 300;

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
  const min = minZoneSize(zone.kind);
  const w = positive(zone.w, meta.w, min.w);
  const h = positive(zone.h, meta.h, min.h);
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
const ZONE_GROUNDS = ['#ffffff', '#f2f4f5'];   // the map on a surface, and on bg-sunken (--es-grey-100)
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

function positive(value, fallback, min = MIN_ZONE_SIZE) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
