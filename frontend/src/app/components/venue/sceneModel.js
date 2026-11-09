import {
  METRES_PER_UNIT, seatPositions, tableBody, toWorld, normaliseShape, worldOf,
} from '../seating/seatingGeometry';
import { zoneBox } from '../seating/venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The 2D map, lifted into a room. Pure: no three.js, no DOM, so it is tested
 * like the geometry it is built on.
 *
 * NOTHING IS DRAWN TWICE. Every seat's floor position comes from
 * `seatingGeometry` exactly as the 2D map places it, then is rotated by the
 * same rule SVG's `rotate()` uses, so seat 17 of row H is where the 2D map
 * says it is, in both views, always. The 3D view adds only what a flat map
 * cannot say:
 *
 *   • HEIGHT. Rows further from the stage rise by the scene's rake, a single
 *     angle, so the room tiers itself into stands without the organizer
 *     placing anything in a third dimension.
 *   • FACING. A row's seats face the stage; a table's seats face the table.
 *   • SCALE. One seat pitch is 0.55 m, so the room has believable proportions
 *     and the seat-view camera sits at a person's eye height.
 *
 * Coordinates: scene x = world x, scene z = world y (both in metres, centred on
 * the content), y is up. Rotating a world point by θ (SVG, y down) is a
 * rotation of −θ about +Y in three.js, which is why box rotations are negated.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// The scale lives with the geometry (the Venue workspace types metres too).
export { METRES_PER_UNIT };
export const EYE_HEIGHT = 1.15;
const ROW_DEPTH = 0.85;
const FLAT_FLOOR = 1.5;

const rad = (deg) => (deg * Math.PI) / 180;

function rotate(px, py, deg) {
  const r = rad(deg);
  return { x: px * Math.cos(r) - py * Math.sin(r), y: px * Math.sin(r) + py * Math.cos(r) };
}

/**
 * @param {object} input
 * @param {Array}  input.tables   [{ id, label, shape, seatCount, position }]
 * @param {Map}    input.seatsByTable  tableId → seats in seat-number order
 * @param {Array}  input.zones    readZones output
 * @param {object} input.scene    readStudio().scene
 * @param {object} input.world    seatingGeometry.worldOf(layout): what the percentages mean
 */
export function buildSceneModel({
  tables = [], seatsByTable = new Map(), zones = [], scene = {}, world = worldOf(null),
}) {
  const k = METRES_PER_UNIT;
  const stage = zones.find((z) => z.kind === 'stage');
  const stageBox = stage ? zoneBox(stage, world) : null;

  // The centre of everything, so the room orbits about its middle.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const t of tables) { const p = toWorld(t.position, world); extend(p.x, p.y); }
  for (const z of zones) { const b = zoneBox(z, world); extend(b.x, b.y); extend(b.right, b.bottom); }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = world.width; maxY = world.height; }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toScene = (x, y) => ({ x: (x - cx) * k, z: (y - cy) * k });

  // What the room faces: the stage's front edge if there is one, else the top
  // of the room, which is where an organizer draws a stage by habit.
  const focusWorld = stageBox ? { x: stageBox.cx, y: stageBox.cy } : { x: cx, y: minY };
  const focus = toScene(focusWorld.x, focusWorld.y);

  const distances = tables.map((t) => {
    const p = toWorld(t.position, world);
    const s = toScene(p.x, p.y);
    return Math.hypot(s.x - focus.x, s.z - focus.z);
  });
  const nearest = distances.length ? Math.min(...distances) : 0;
  const slope = Math.tan(rad(Number(scene.rake) || 0));

  const seats = [];
  const bodies = [];
  const risers = [];
  let radius = 10;

  tables.forEach((t, ti) => {
    const pos = toWorld(t.position, world);
    const shape = normaliseShape(t.shape);
    const centre = toScene(pos.x, pos.y);
    const isRow = shape === 'row';
    // Tables at a gala stay on the floor even with a rake: the rise is for
    // rows. A round table on a slope is not a room anyone has sat in.
    const elev = isRow ? Math.max(0, distances[ti] - nearest - FLAT_FLOOR) * slope : 0;
    const list = seatsByTable.get(t.id) || [];

    seatPositions(shape, t.seatCount).forEach((pt, i) => {
      const r = rotate(pt.x, pt.y, pos.rotation);
      const s = toScene(pos.x + r.x, pos.y + r.y);
      const target = isRow ? focus : centre;
      const seat = list[i];
      seats.push({
        id: seat?.id || `${t.id}:${i}`,
        seat: seat || null,
        tableId: t.id,
        tableLabel: t.label,
        number: seat?.number ?? String(i + 1),
        x: s.x,
        y: elev,
        z: s.z,
        yaw: Math.atan2(-(target.x - s.x), -(target.z - s.z)),
      });
      radius = Math.max(radius, Math.hypot(s.x, s.z));
    });

    const body = tableBody(shape, t.seatCount);
    if (isRow) {
      if (elev > 0.02) {
        risers.push({
          x: centre.x, z: centre.z, h: elev,
          w: body.width * k + 0.3, d: ROW_DEPTH, rot: -rad(pos.rotation),
        });
      }
    } else {
      bodies.push({
        id: t.id, label: t.label, kind: body.kind, x: centre.x, z: centre.z,
        w: body.width * k, d: body.height * k, rot: -rad(pos.rotation),
      });
    }
  });

  const zoneShapes = zones.map((z) => {
    const b = zoneBox(z, world);
    const c = toScene(b.cx, b.cy);
    radius = Math.max(radius, Math.hypot(c.x, c.z) + Math.max(b.w, b.h) * k / 2);
    return {
      id: z.id, kind: z.kind, label: z.label || null, color: z.color || null,
      x: c.x, z: c.z, w: b.w * k, d: b.h * k, rot: -rad(b.rotation),
    };
  });

  const topRise = seats.reduce((m, s) => Math.max(m, s.y), 0);
  return { seats, bodies, risers, zones: zoneShapes, focus, radius, topRise, hasStage: !!stage };
}

/** Where a person in this seat has their eyes, and what they look at. */
export function eyeFor(seat, model, scene) {
  const stageTop = (Number(scene?.stageHeight) || 0) + 1.4;
  return {
    position: { x: seat.x, y: seat.y + EYE_HEIGHT, z: seat.z },
    target: { x: model.focus.x, y: model.hasStage ? stageTop : EYE_HEIGHT, z: model.focus.z },
  };
}

/** The performer's view: from the front of the stage, looking out at the room. */
export function stageEye(model, scene) {
  const height = (Number(scene?.stageHeight) || 0) + 2.3;
  const away = Math.hypot(model.focus.x, model.focus.z) || 1;
  // A step from the stage's centre toward the room, so the camera is not
  // inside the screen wall.
  const step = Math.min(2, away);
  const ux = -model.focus.x / away;
  const uz = -model.focus.z / away;
  return {
    position: { x: model.focus.x + ux * step, y: height, z: model.focus.z + uz * step },
    target: { x: 0, y: model.topRise * 0.5 + 1, z: 0 },
  };
}

/**
 * The best open seat to start a 360° view from when nothing is chosen yet: the
 * available seat nearest the stage's centre line, the one a buyer would want.
 */
export function bestSeat(model, isAvailable) {
  // The stage's centre line runs from the stage toward the middle of the room.
  // The ideal is on that line, about two fifths of the way back: close enough
  // to see faces, far enough to take in the whole stage.
  const len = Math.hypot(model.focus.x, model.focus.z) || 1;
  const ux = -model.focus.x / len;
  const uz = -model.focus.z / len;
  const along = (s) => (s.x - model.focus.x) * ux + (s.z - model.focus.z) * uz;
  const depth = model.seats.reduce((mx, s) => Math.max(mx, along(s)), 0);
  const ideal = Math.max(4, depth * 0.4);
  let best = null;
  let score = Infinity;
  for (const s of model.seats) {
    if (!isAvailable(s)) continue;
    const a = along(s);
    const lateral = Math.abs((s.x - model.focus.x) * uz - (s.z - model.focus.z) * ux);
    const v = Math.abs(a - ideal) + lateral * 1.5;
    if (v < score) { score = v; best = s; }
  }
  return best || model.seats.find(isAvailable) || null;
}
