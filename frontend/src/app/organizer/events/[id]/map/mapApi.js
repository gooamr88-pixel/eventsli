import {
  contentBounds, worldOf, toWorld, toPercent, tableBody, tableScale, seatPositions, SEAT_RADIUS,
} from '../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../components/seating/venueZones';

/**
 * The editor's conversions to and from the map API, and the frame it opens on.
 * Split out of MapEditor.jsx (2026-11-09) when the Venue Studio was added to it.
 */
/** The API's table → the editor's. `password` is never returned, only
 *  `hasPassword`, so the field starts empty and an untouched one means keep. */
export function fromApi(t) {
  return {
    id: t.id,
    label: t.label,
    seatCount: t.seatCount,
    priceCents: t.priceCents,
    isPrivate: t.isPrivate,
    hasPassword: t.hasPassword,
    status: t.status,
    shape: t.shape,
    categoryId: t.categoryId,
    // The TABLE's ticket type and seat price, as the organizer last set them
    // (TECH-AUDIT-LOG S-02). They were read off the first seat, and seats
    // arrive in id order: after a partial sale that could be a sold seat of the
    // old type, which the next save then put back on every available seat.
    tierId: t.tierId || null,
    seatPriceCents: t.seatPriceCents ?? null,
    // How much of this table buyers already have — held or sold. Drawn on the
    // canvas, and the reason a delete or a shrink will be refused.
    soldSeats: (t.seats || []).filter((s) => s.status === 'held' || s.status === 'sold').length,
    // The organizer's own blocks (S-08): not on sale, but not a buyer's either,
    // so they never stop a table being moved, shrunk or removed.
    blockedSeats: (t.seats || []).filter((s) => s.status === 'blocked').length,
    position: t.position,
  };
}

/**
 * The editor's table → the API's.
 *
 * `sections` (label → { section, row }, from the Studio's sections) gives a
 * row of a seating section its address: its seats are saved as Section · Row
 * · Seat rather than the table's label and row 'A' (TECH-AUDIT-LOG S-19), so
 * tickets, emails and the door say what the buyer chose.
 */
export function toApi(t, sections = null) {
  const where = sections?.get(String(t.label).trim()) || null;
  return {
    ...(where ? { section: where.section, row: where.row } : {}),
    // Absent on a new table, which is how the API tells create from update.
    ...(t.id ? { id: t.id } : {}),
    label: String(t.label).trim(),
    seatCount: Number(t.seatCount),
    priceCents: t.priceCents ?? null,
    isPrivate: !!t.isPrivate,
    // Sent only when actually typed. Sending the editor's state back without a
    // password must not silently unprotect a table — the API keeps the existing
    // hash unless a new one arrives, and clears it only on `isPrivate: false`.
    ...(t.password ? { password: t.password } : {}),
    shape: t.shape,
    categoryId: t.categoryId || null,
    tierId: t.tierId || null,
    seatPriceCents: t.seatPriceCents ?? null,
    position: {
      x: t.position?.x ?? 0,
      y: t.position?.y ?? 0,
      rotation: t.position?.rotation ?? 0,
    },
  };
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** The venue's floor (its world) united with everything drawn, plus a 5% margin all round, so
 *  the sheet sits ON the canvas instead of being cut by its edges. */
export function frameFor(tables, zones, world = worldOf(null)) {
  const c = (tables.length || zones.length) ? contentBounds(tables, zones, world) : { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(0, c.x);
  const y0 = Math.min(0, c.y);
  const x1 = Math.max(world.width, c.x + c.width);
  const y1 = Math.max(world.height, c.y + c.height);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 };
}

export function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * WHERE A NEW THING LANDS (2026-11-21): in the middle of what the organizer
 * is looking at, at the nearest spot where it covers nothing already drawn.
 *
 * It used to land at the view's top-left corner, inset a little, on top of
 * whatever was there — so a stage could appear half under a row of seats in
 * a corner the eye was not on. Candidates spiral out from the view's centre
 * in steps of the item's own size; the first that overlaps no table (with its
 * seats) and no area wins, kept inside the venue. If the view is full, the
 * centre — visible, and selected, so it can be dragged where it belongs.
 *
 * Returns a position in percentages of the world, as zones store it.
 */
/**
 * A table's real footprint on the floor: its body and every seat, turned by
 * its rotation and scaled by its size — as a box in world units. (`tableReach`
 * is a radius, which counts a 22-seat row as a 560-unit square and left no
 * room anywhere for a new stage.)
 */
function tableFootprint(t, world) {
  const p = toWorld(t.position, world);
  const k = tableScale(t.style);
  const body = tableBody(t.shape, t.seatCount, t.style);
  const pts = [
    [-body.width / 2, -body.height / 2], [body.width / 2, body.height / 2],
    ...seatPositions(t.shape, t.seatCount, t.style).flatMap((s) => [
      [s.x - SEAT_RADIUS, s.y - SEAT_RADIUS], [s.x + SEAT_RADIUS, s.y + SEAT_RADIUS],
    ]),
  ];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const a = (p.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = (x1 - x0) * k;
  const h = (y1 - y0) * k;
  const halfW = (w * c + h * s) / 2;
  const halfH = (w * s + h * c) / 2;
  // The centre of the unrotated box, turned with the table.
  const mx = ((x0 + x1) / 2) * k;
  const my = ((y0 + y1) / 2) * k;
  const cx = p.x + mx * Math.cos(a) - my * Math.sin(a);
  const cy = p.y + mx * Math.sin(a) + my * Math.cos(a);
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

export function freeSpot(view, size, tables, zones, world = worldOf(null)) {
  const gap = 12;
  const boxes = [
    ...tables.map((t) => tableFootprint(t, world)),
    ...zones.map((z) => {
      const b = zoneBox(z, world);
      return { x0: b.x, y0: b.y, x1: b.right, y1: b.bottom };
    }),
  ];
  const fits = (cx, cy) => {
    const a = { x0: cx - size.w / 2 - gap, y0: cy - size.h / 2 - gap, x1: cx + size.w / 2 + gap, y1: cy + size.h / 2 + gap };
    if (a.x0 + gap < 0 || a.y0 + gap < 0 || a.x1 - gap > world.width || a.y1 - gap > world.height) return false;
    return !boxes.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
  };
  const cx = clamp(view.x + view.width / 2, size.w / 2, world.width - size.w / 2);
  const cy = clamp(view.y + view.height / 2, size.h / 2, world.height - size.h / 2);
  // Half-size steps find the gaps between rows; on screen first, then
  // anywhere in the venue, nearest the view's centre either way.
  const stepX = Math.max(20, size.w / 2);
  const stepY = Math.max(20, size.h / 2);
  const onScreen = (x, y) => x >= view.x && x <= view.x + view.width && y >= view.y && y <= view.y + view.height;
  for (const pass of ['screen', 'venue']) {
    const rings = pass === 'screen' ? 24 : 60;
    for (let ring = 0; ring <= rings; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;   // this ring only
          const x = cx + dx * stepX;
          const y = cy + dy * stepY;
          if (pass === 'screen' && !onScreen(x, y)) continue;
          if (fits(x, y)) return toPercent(x, y, world);
        }
      }
    }
  }
  return toPercent(cx, cy, world);
}
