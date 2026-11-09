import { contentBounds, worldOf } from '../../../../components/seating/seatingGeometry';

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
