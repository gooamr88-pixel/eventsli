import { seatPositions, toWorld, worldOf, SEAT_RADIUS } from '../seating/seatingGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The shape of each section on the 2D map: a tinted plate behind its seats.
 *
 * A venue map reads as SECTIONS first and seats second — "the gold block left
 * of the stage", then "row H". Bare dots make every block the same grey
 * field. The plate is the convex hull of the section's seat centres, pushed
 * out by a seat and a half so no chair sits on its edge, in the section's
 * ticket-type colour. Pure and in world units, like the geometry it reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PAD = SEAT_RADIUS * 1.9;

/** World-space seat centres of one table, the way the map draws them, in the
 *  map's own world (`seatingGeometry.worldOf`). */
export function seatPoints(table, world = worldOf(null)) {
  const p = toWorld(table.position, world);
  const r = (p.rotation * Math.PI) / 180;
  return seatPositions(table.shape, table.seatCount).map((pt) => ({
    x: p.x + pt.x * Math.cos(r) - pt.y * Math.sin(r),
    y: p.y + pt.x * Math.sin(r) + pt.y * Math.cos(r),
  }));
}

/** Andrew's monotone chain. Returns the hull counter-clockwise. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The hull, grown by `pad` and drawn with rounded corners: each vertex
 * becomes an arc, which is the exact outline of the hull dilated by a circle.
 */
export function roundedHullPath(points, pad = PAD) {
  const hull = convexHull(points);
  if (hull.length === 0) return '';
  if (hull.length < 3) {
    // One seat or a single straight row: a capsule around it.
    const a = hull[0];
    const b = hull[hull.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = -Math.sin(ang) * pad;
    const ny = Math.cos(ang) * pad;
    return `M${a.x + nx} ${a.y + ny}L${b.x + nx} ${b.y + ny}A${pad} ${pad} 0 0 0 ${b.x - nx} ${b.y - ny}L${a.x - nx} ${a.y - ny}A${pad} ${pad} 0 0 0 ${a.x + nx} ${a.y + ny}Z`;
  }
  const n = hull.length;
  const normal = (p, q) => {
    const dx = q.x - p.x; const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    // The hull is counter-clockwise in a y-down world, so the outward normal
    // of each edge points to its right-hand side.
    return { x: dy / len, y: -dx / len };
  };
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const p = hull[i];
    const q = hull[(i + 1) % n];
    const nm = normal(p, q);
    const start = { x: p.x + nm.x * pad, y: p.y + nm.y * pad };
    const end = { x: q.x + nm.x * pad, y: q.y + nm.y * pad };
    d += i === 0 ? `M${r(start.x)} ${r(start.y)}` : `A${pad} ${pad} 0 0 1 ${r(start.x)} ${r(start.y)}`;
    d += `L${r(end.x)} ${r(end.y)}`;
  }
  const first = normal(hull[0], hull[1]);
  return `${d}A${pad} ${pad} 0 0 1 ${r(hull[0].x + first.x * pad)} ${r(hull[0].y + first.y * pad)}Z`;
}

const r = (n) => Math.round(n * 10) / 10;

/**
 * One plate per section: [{ key, name, d, color }].
 * @param sections  liveSections output
 * @param tables    the map's tables (label, shape, seatCount, position, id)
 * @param colorOf   tableId → colour
 * @param world     the map's world (seatingGeometry.worldOf)
 */
export function sectionPlates(sections, tables, colorOf, world = worldOf(null)) {
  const byLabel = new Map(tables.map((t) => [t.label, t]));
  return sections.map((s) => {
    const rows = s.rows.map((row) => byLabel.get(row.table)).filter(Boolean);
    const pts = rows.flatMap((t) => seatPoints(t, world));
    return { key: s.id, name: s.name, d: roundedHullPath(pts), color: colorOf(rows[0]?.id) || '#17a2a6' };
  }).filter((p) => p.d);
}
