import { toWorld, toPercent } from '../seating/seatingGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where each real seat appears in a 360° photo. Pure: no three.js, no DOM.
 *
 * A photo is a sphere of directions around one point. If we know that point
 * (the organizer's `spot`: a place on the map and a camera height) and which
 * direction in the photo is the stage (`heading`, the "Opens facing" setting
 * the studio already had), every seat's direction follows from the same 3D
 * room the 3D view draws. No image recognition, no guessing: a dot sits on a
 * seat because the layout says the seat is there.
 *
 * Angles use the viewers' one convention: looking along yaw/pitch is the
 * direction (−sin yaw · cos pitch, sin pitch, −cos yaw · cos pitch). Yaw 0
 * looks up the map (−z); a larger yaw turns left.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Roughly where a chair is seen: its back, about this far above the floor. */
const CHAIR_AIM = 0.55;
/** A seat this close to the camera is the one it stands at: no dot. */
const UNDER_CAMERA = 0.3;
/** A tripod at standing eye height; what a missing height means. */
export const DEFAULT_PHOTO_HEIGHT = 1.5;

const DEG = Math.PI / 180;

/** A map spot (percentages, as table positions are) → scene metres. */
export function spotToScene(model, spot) {
  const { cx, cy, k, world } = model.origin;
  const w = toWorld(spot, world);
  return { x: (w.x - cx) * k, z: (w.y - cy) * k };
}

/** Scene metres → a map spot. The inverse of spotToScene. */
export function sceneToSpot(model, x, z) {
  const { cx, cy, k, world } = model.origin;
  return toPercent(x / k + cx, z / k + cy, world);
}

/** The direction a yaw/pitch looks along, in the viewers' convention. */
export function direction(yaw, pitch) {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

const yawFrom = (from, x, z) => Math.atan2(-(x - from.x), -(z - from.z));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The floor under a point: the height of the nearest seat's row, 0 if none. */
function floorAt(model, p) {
  let best = Infinity;
  let y = 0;
  for (const s of model.seats) {
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d < best) { best = d; y = s.y; }
  }
  return y;
}

/**
 * A first guess at where a photo was taken: the middle of the rows it is
 * linked to (or of the whole room), at standing height. The organizer moves
 * it from there; buyers never see dots placed by this guess alone, because a
 * view only carries a `spot` once the organizer has saved one.
 */
export function guessSpot(model, labels = []) {
  const wanted = new Set(labels);
  let seats = model.seats.filter((s) => wanted.has(s.tableLabel));
  if (!seats.length) seats = model.seats;
  if (!seats.length) return { x: 50, y: 50, h: DEFAULT_PHOTO_HEIGHT };
  const x = seats.reduce((n, s) => n + s.x, 0) / seats.length;
  const z = seats.reduce((n, s) => n + s.z, 0) / seats.length;
  return { ...sceneToSpot(model, x, z), h: DEFAULT_PHOTO_HEIGHT };
}

/**
 * Every seat's place in the photo: [{ entry, yaw, pitch, distance }].
 *
 * `onlyLinked` keeps the seats of the rows the photo is linked to — what a
 * buyer is offered. The studio passes false, so the organizer lines up the
 * photo against every chair in it.
 */
export function projectSeats(model, view, { spot = view?.spot, onlyLinked = true } = {}) {
  if (!model || !view || !spot) return [];
  const p = spotToScene(model, spot);
  const eyeY = floorAt(model, p) + (Number(spot.h) || DEFAULT_PHOTO_HEIGHT);
  // The photo's yaw for "the stage" is its heading; every other direction
  // keeps its angle from the stage, so one offset maps room → photo.
  const offset = (Number(view.heading) || 0) * DEG - yawFrom(p, model.focus.x, model.focus.z);
  const wanted = onlyLinked ? new Set(view.tables || []) : null;

  const out = [];
  for (const s of model.seats) {
    if (wanted && !wanted.has(s.tableLabel)) continue;
    const flat = Math.hypot(s.x - p.x, s.z - p.z);
    if (flat < UNDER_CAMERA) continue;
    const dy = s.y + CHAIR_AIM - eyeY;
    out.push({
      entry: s,
      yaw: wrap(offset + yawFrom(p, s.x, s.z)),
      pitch: Math.atan2(dy, flat),
      distance: Math.hypot(flat, dy),
    });
  }
  return out;
}
