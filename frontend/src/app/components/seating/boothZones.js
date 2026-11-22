/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDOR BOOTHS ON THE VENUE MAP (2026-11-22, the owner: "merge the seating
 * map of the event and the seating map of vendors, professionally").
 *
 * ONE DRAWING OF THE HALL, TWO KINDS OF STOCK. Seats are sold to buyers and
 * live in `tables`/`seats`; booths are sold to vendors and live in
 * `vendor_floor_plans.plan`, where every offer and booking points at a booth's
 * id (`vendor_applications.booth_key`). Neither store moves. What is merged is
 * the drawing: a reserved-seating event's booths are drawn, edited and shown
 * ON its seat map, in the seat map's own world, beside the tables.
 *
 * A general-admission expo has no seat map (the database refuses one), so it
 * keeps the standalone floor plan editor — that path is untouched.
 *
 * THE CONVERSION. The editor carries each booth as a zone of kind `booth`
 * (venueZones.BOOTH_KIND), so it gets every zone tool for free. A zone is a
 * CENTRE in percent of the world with a size in world units; a plan booth is
 * a TOP-LEFT corner and a size in plan units, turned about its centre. A
 * linked plan (`onSeatMap: true`) is saved with the world's own size, so plan
 * units ARE world units — but a venue resized since is scaled on read, the
 * way tables keep their percentages when the venue grows.
 *
 * The booth's CODE (A1, DB7) is the zone's `label`, so the print pack, the 3D
 * preview and screen readers name it without knowing what a booth is.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { BOOTH_KIND, BOOTH_META } from './venueZones';
import { worldOf } from './seatingGeometry';

export { BOOTH_KIND, BOOTH_META };

/** The server's ceiling for one floor plan (vendorFloorPlan.MAX_ELEMENTS). */
export const MAX_BOOTHS = 3000;
const MAX_CODE = 12;

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const isBooth = (zone) => zone?.kind === BOOTH_KIND;

/** Booths in a plan, read defensively (the server cleaned them already). */
export function planBooths(plan) {
  return (Array.isArray(plan?.elements) ? plan.elements : []).filter((e) => e && e.kind === 'booth');
}

/**
 * A plan's booths as editor zones, in this world.
 *
 * `withState` (the buyer's map and the viewers) folds each booth's status and
 * colour into the zone, so a renderer that only has the zone can draw it.
 * The editor leaves it off and looks both up live, because a booth type
 * chosen in the inspector has to recolour the booth at once.
 */
export function boothsToZones(plan, world = worldOf(null), { withState = null } = {}) {
  const pw = num(plan?.width, world.width) || world.width;
  const ph = num(plan?.height, world.height) || world.height;
  const sx = world.width / pw;
  const sy = world.height / ph;
  return planBooths(plan).slice(0, MAX_BOOTHS).map((b) => {
    const w = Math.max(BOOTH_META.min.w, num(b.w, 60) * sx);
    const h = Math.max(BOOTH_META.min.h, num(b.h, 60) * sy);
    const cx = (num(b.x, 0) * sx) + w / 2;
    const cy = (num(b.y, 0) * sy) + h / 2;
    const zone = {
      id: String(b.id),
      kind: BOOTH_KIND,
      label: String(b.code || '').slice(0, MAX_CODE),
      x: round3(clamp((cx / world.width) * 100, 0, 100)),
      y: round3(clamp((cy / world.height) * 100, 0, 100)),
      w: round1(w),
      h: round1(h),
      rotation: ((num(b.r, 0) % 360) + 360) % 360,
      color: null,
      boothTypeId: b.boothTypeId || null,
      blocked: b.blocked === true,
    };
    if (withState) {
      zone.state = withState.states?.[b.id] || null;
      zone.typeColor = boothColor(withState.boothTypes || [], zone.boothTypeId);
      zone.typeName = (withState.boothTypes || []).find((t) => t.id === zone.boothTypeId)?.name || null;
    }
    return zone;
  });
}

/** The booth zones as the plan the vendor API stores: world units, linked. */
export function zonesToPlan(zones, world = worldOf(null)) {
  const elements = (zones || []).filter(isBooth).slice(0, MAX_BOOTHS).map((z) => {
    const w = round1(Math.max(BOOTH_META.min.w, num(z.w, BOOTH_META.w)));
    const h = round1(Math.max(BOOTH_META.min.h, num(z.h, BOOTH_META.h)));
    const cx = (num(z.x, 50) / 100) * world.width;
    const cy = (num(z.y, 50) / 100) * world.height;
    const r = round1(((num(z.rotation, 0) % 360) + 360) % 360);
    return {
      id: z.id,
      kind: 'booth',
      x: round1(cx - w / 2),
      y: round1(cy - h / 2),
      w,
      h,
      // The server bounds rotation to ±360; keep it in −180…180 so it reads well.
      r: r > 180 ? round1(r - 360) : r,
      code: String(z.label || '').trim().slice(0, MAX_CODE),
      boothTypeId: z.boothTypeId || null,
      blocked: z.blocked === true,
    };
  });
  return { width: world.width, height: world.height, onSeatMap: true, elements };
}

/** True when two plans would save the same booths (order-insensitive). */
export function samePlan(a, b) {
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height || !!a.onSeatMap !== !!b.onSeatMap) return false;
  const key = (e) => [e.id, e.x, e.y, e.w, e.h, e.r || 0, e.code || '', e.boothTypeId || '', e.blocked ? 1 : 0].join('|');
  const left = planBooths(a).map(key).sort();
  const right = planBooths(b).map(key).sort();
  return left.length === right.length && left.every((k, i) => k === right[i]);
}

/** "A" → the next free number after the highest "A<n>" already on the map. */
export function nextBoothNumber(zones, prefix) {
  const escaped = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(\\d+)$`, 'i');
  let max = 0;
  for (const z of zones || []) {
    if (!isBooth(z)) continue;
    const m = String(z.label || '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** "A7" → "A"; "12" → ""; "Stage" → "Stage". */
export function codePrefix(code) {
  return String(code || '').replace(/\d+$/, '');
}

/**
 * A row of touching booths, as zone specs for `useMapDraft.addZones`: `count`
 * booths of `w`×`h` world units with `gap` between, numbered prefix+start…,
 * running across or down, centred on `centre` (percent of the world).
 */
export function boothRowSpecs({
  centre, count, w, h, gap = 0, direction = 'right', prefix = '', start = 1, boothTypeId = null,
}, world = worldOf(null)) {
  const n = Math.max(1, Math.min(60, Math.floor(Number(count) || 1)));
  const across = direction !== 'down';
  const totalW = across ? n * w + (n - 1) * gap : w;
  const totalH = across ? h : n * h + (n - 1) * gap;
  const cx = (num(centre?.x, 50) / 100) * world.width;
  const cy = (num(centre?.y, 50) / 100) * world.height;
  const x0 = cx - totalW / 2 + w / 2;
  const y0 = cy - totalH / 2 + h / 2;
  return Array.from({ length: n }, (_, i) => ({
    kind: BOOTH_KIND,
    position: {
      x: clamp(((x0 + (across ? i * (w + gap) : 0)) / world.width) * 100, 0, 100),
      y: clamp(((y0 + (across ? 0 : i * (h + gap))) / world.height) * 100, 0, 100),
    },
    overrides: { w, h, boothTypeId: boothTypeId || null, blocked: false, label: `${prefix}${start + i}`.slice(0, MAX_CODE) },
  }));
}

/** The size a row of booths occupies, for finding it a free spot. */
export function boothRowSize({ count, w, h, gap = 0, direction = 'right' }) {
  const n = Math.max(1, Math.min(60, Math.floor(Number(count) || 1)));
  return direction === 'down' ? { w, h: n * h + (n - 1) * gap } : { w: n * w + (n - 1) * gap, h };
}

/* ── colours, shared by every view so a booth looks the same everywhere ──── */

export const BOOTH_INK = Object.freeze({
  free: '#e7e7ec',
  taken: '#8f8f8f',
  stroke: '#1d1d1f',
  pink: '#d4157a',
  mine: '#d61f2c',
});
const PALETTE = ['#18a8e8', '#9b59b6', '#f26522', '#21b05c', '#f5c518', '#e84393', '#00b8a9', '#5c6bc0'];

/** A booth type's colour, or a stable one from the palette by its position. */
export function boothColor(boothTypes, id) {
  if (!id) return BOOTH_INK.free;
  const i = (boothTypes || []).findIndex((t) => t.id === id);
  if (i < 0) return BOOTH_INK.free;
  return boothTypes[i].color || PALETTE[i % PALETTE.length];
}

/** A booth's status: the server's word for it, or what its own flags say. */
export function boothStatus(zone, state) {
  if (state?.status) return state.status;
  return zone?.blocked ? 'blocked' : 'available';
}

/** "A1, sold to Bean Co." — what a screen reader hears for a booth. */
export function boothSentence(zone, state) {
  const code = String(zone?.label || '').trim() || 'Booth';
  const status = boothStatus(zone, state);
  if (status === 'sold') return `Booth ${code}, booked${state?.vendor ? ` by ${state.vendor.name}` : ''}`;
  if (status === 'held') return `Booth ${code}, reserved${state?.vendor ? ` for ${state.vendor.name}` : ''}`;
  if (status === 'blocked') return `Booth ${code}, unavailable`;
  return `Booth ${code}, available`;
}

/**
 * The plan as the public viewers draw it: on a linked plan, scaled to the
 * venue's current world (a venue resized since the booths were last saved
 * keeps them where they were, relatively, as it does tables).
 */
export function alignPlan(plan, world) {
  if (!plan || !world || !plan.onSeatMap) return plan;
  if (plan.width === world.width && plan.height === world.height) return plan;
  const sx = world.width / (plan.width || world.width);
  const sy = world.height / (plan.height || world.height);
  return {
    ...plan,
    width: world.width,
    height: world.height,
    elements: planBooths(plan).map((b) => ({
      ...b, x: round1(b.x * sx), y: round1(b.y * sy), w: round1(b.w * sx), h: round1(b.h * sy),
    })),
  };
}
