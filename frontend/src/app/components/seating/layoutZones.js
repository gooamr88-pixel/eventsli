/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Zones ↔ `venue_maps.layout_json`.
 *
 * The map API round-trips that column verbatim: `save_venue_map` writes
 * whatever JSONB it is handed and `getMapForOrganizer` hands it straight back.
 * The editor already preserved it untouched — its comment says the blob "is
 * ours to define and nothing reads it yet". This defines it.
 *
 *   layout = {
 *     world: { width, height },        // already written by the editor
 *     zones: [ { id, kind, label, x, y, w, h, rotation, color } ],
 *     ...anything a later version adds
 *   }
 *
 * READING IS DEFENSIVE AND WRITING IS STRICT, which is the only combination
 * that survives a column with no schema behind it. Nothing validates this blob
 * on the way in but this file, and nothing repairs it on the way out. So a row
 * that is malformed — hand-edited, written by a newer editor, truncated — is
 * DROPPED on read rather than allowed to reach a renderer, and everything
 * written back is clamped and rounded to what the renderers can draw.
 *
 * UNKNOWN KEYS ON THE BLOB ARE PRESERVED. `writeZones` spreads the layout it is
 * given and replaces one key. A future `layout.floorPlanImage` must not be
 * destroyed by an editor that predates it, because the save is a full replace
 * and there is nothing to merge against afterwards.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { MAX_ZONES, MIN_ZONE_SIZE, ZONES, zoneMeta } from './venueZones';
import { WORLD } from './seatingGeometry';

/** Matches `NUMERIC(6,3)` on the table positions, so zones and tables round
 *  identically and a saved layout reads back byte-for-byte. */
const round3 = (n) => Math.round(n * 1000) / 1000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Every drawable zone in a layout blob, in paint order.
 *
 * A zone with no recognisable kind is not guessed at — `zoneMeta` would happily
 * return the custom box, and a "Stge" typo would silently become an anonymous
 * rectangle that the organizer then cannot find in the catalogue to fix. It is
 * dropped, and `readZones` is the only place that decision is made.
 */
export function readZones(layout) {
  const raw = Array.isArray(layout?.zones) ? layout.zones : [];
  const out = [];
  const seen = new Set();

  for (const z of raw) {
    if (!z || typeof z !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(ZONES, z.kind)) continue;

    // A duplicate id is not cosmetic: React keys it, selection addresses it and
    // a drag moves whichever one the lookup found first. Keeping the first and
    // re-identifying the rest loses nothing.
    const id = typeof z.id === 'string' && z.id && !seen.has(z.id) ? z.id : newZoneId();
    seen.add(id);

    const meta = zoneMeta(z.kind);
    out.push({
      id,
      kind: z.kind,
      label: typeof z.label === 'string' ? z.label.slice(0, 40) : '',
      x: clamp(num(z.x, 50), 0, 100),
      y: clamp(num(z.y, 50), 0, 100),
      w: clamp(num(z.w, meta.w), MIN_ZONE_SIZE, WORLD.width),
      h: clamp(num(z.h, meta.h), MIN_ZONE_SIZE, WORLD.height),
      rotation: ((num(z.rotation, 0) % 360) + 360) % 360,
      color: typeof z.color === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(z.color) ? z.color : null,
    });

    if (out.length >= MAX_ZONES) break;
  }

  return out;
}

/**
 * The layout blob with this zone list in it.
 *
 * `color: null` is written as an ABSENT key rather than an explicit null, so a
 * zone using its kind's colour keeps following that kind if the catalogue is
 * ever retuned. Storing the resolved colour would freeze today's palette into
 * every map ever saved.
 */
export function writeZones(layout, zones) {
  return {
    ...(layout && typeof layout === 'object' ? layout : {}),
    zones: (zones || []).slice(0, MAX_ZONES).map((z) => ({
      id: z.id,
      kind: z.kind,
      ...(String(z.label || '').trim() ? { label: String(z.label).trim().slice(0, 40) } : {}),
      x: round3(clamp(num(z.x, 50), 0, 100)),
      y: round3(clamp(num(z.y, 50), 0, 100)),
      w: round3(clamp(num(z.w, zoneMeta(z.kind).w), MIN_ZONE_SIZE, WORLD.width)),
      h: round3(clamp(num(z.h, zoneMeta(z.kind).h), MIN_ZONE_SIZE, WORLD.height)),
      rotation: round3(((num(z.rotation, 0) % 360) + 360) % 360),
      ...(z.color ? { color: z.color } : {}),
    })),
  };
}

/**
 * A fresh zone of a kind, centred on a point (percentages of the world).
 *
 * The size comes from the catalogue, never from the caller, so every stage
 * starts the same size and an organizer laying out four rooms gets four rooms
 * that look alike. Resizing afterwards is one drag.
 */
export function makeZone(kind, position, overrides = {}) {
  const meta = zoneMeta(kind);
  return {
    id: newZoneId(),
    kind: Object.prototype.hasOwnProperty.call(ZONES, kind) ? kind : 'custom',
    label: '',
    x: clamp(num(position?.x, 50), 0, 100),
    y: clamp(num(position?.y, 50), 0, 100),
    w: meta.w,
    h: meta.h,
    rotation: 0,
    color: null,
    ...overrides,
  };
}

/**
 * An id that is unique within one browser session and stable across a save.
 *
 * `crypto.randomUUID` where it exists, which is everywhere this app runs — the
 * fallback is for jsdom and for a non-secure origin, where it is absent but the
 * only consumer is a test. Deliberately NOT a counter: the editor's save is a
 * full replace, so two zones added in two sessions can meet in one blob, and
 * two `zone-3`s is the duplicate-id case `readZones` has to clean up.
 */
export function newZoneId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `z_${c.randomUUID()}`;
  return `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
