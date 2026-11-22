/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VENDOR FLOOR PLAN, as data (owner, 2026-11-20: "how can I create a
 * vendors seating map? … very professional, as this exactly" — two expo-hall
 * floor plans: an orange wall outline with door swings, grey booths marked
 * SOLD or unavailable, free booths in their category colour with a code
 * (DB1, DB2…), a blue stage block, a green restaurant block, round tables with
 * chairs, an arc of theatre seats, traffic arrows and a "Lobby" label).
 *
 * Pure: no database. The plan is ONE JSON document the organizer's editor
 * writes whole; everything a browser sends is a claim, so every element is
 * rebuilt here from known kinds, bounded numbers and short strings — nothing
 * unknown is stored, and nothing stored can become markup.
 *
 *   plan = { width, height, elements: [ … ] }
 *
 *   booth  { id, kind, x, y, w, h, r, code, boothTypeId, blocked }   the stock
 *   wall   { id, kind, points: [[x, y], …], closed }                 the room
 *   door   { id, kind, x, y, size, r, double }                       a swing
 *   area   { id, kind, x, y, w, h, r, text, sub, fill, textColor }   stage, café
 *   label  { id, kind, x, y, text, size, color, r }                  "Lobby"
 *   arrow  { id, kind, x1, y1, x2, y2, color }                       foot traffic
 *   table  { id, kind, x, y, size, seats }                           décor
 *   seats  { id, kind, x, y, rows, radius, spread, r }               décor
 *
 * Only booths are sold. Everything else is drawing.
 *
 * `onSeatMap: true` (2026-11-22) marks a reserved-seating event's plan whose
 * booths are drawn ON its venue map: the venue map editor owns the drawing,
 * the plan holds the booths in the map's world, and viewers get the seat map's
 * room and tables with it (vendorService.seatMapContext).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KINDS = Object.freeze(['booth', 'wall', 'door', 'area', 'label', 'arrow', 'table', 'seats']);
const MAX_ELEMENTS = 3000;
const MAX_WALL_POINTS = 400;
const DEFAULT_SIZE = Object.freeze({ width: 1200, height: 800 });
const HEX = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9_-]{1,40}$/i;

class FloorPlanError extends Error {
  constructor(message) {
    super(message);
    this.code = 'VALIDATION_ERROR';
  }
}

const round1 = (n) => Math.round(n * 10) / 10;
function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return round1(Math.min(max, Math.max(min, n)));
}
const str = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const hex = (value, fallback) => (HEX.test(String(value || '')) ? String(value).toLowerCase() : fallback);

/**
 * A plan as stored. Throws a FloorPlanError (VALIDATION_ERROR) for a plan that
 * cannot be read at all; silently drops elements of unknown kinds.
 */
function cleanPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FloorPlanError('The floor plan could not be read.');
  const width = num(input.width, 200, 20000, DEFAULT_SIZE.width);
  const height = num(input.height, 200, 20000, DEFAULT_SIZE.height);
  const list = Array.isArray(input.elements) ? input.elements : [];
  if (list.length > MAX_ELEMENTS) throw new FloorPlanError(`A floor plan holds at most ${MAX_ELEMENTS} items.`);

  const X = (v) => num(v, -width, width * 2, 0);
  const Y = (v) => num(v, -height, height * 2, 0);
  const R = (v) => num(v, -360, 360, 0);
  const seen = new Set();
  let auto = 0;
  const idOf = (raw) => {
    let id = ID.test(String(raw || '')) ? String(raw) : '';
    while (!id || seen.has(id)) { auto += 1; id = `e${auto}`; }
    seen.add(id);
    return id;
  };

  const elements = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || !KINDS.includes(e.kind)) continue;
    const base = { id: idOf(e.id), kind: e.kind };
    switch (e.kind) {
      case 'booth':
        elements.push({
          ...base, x: X(e.x), y: Y(e.y), w: num(e.w, 8, 2000, 60), h: num(e.h, 8, 2000, 60), r: R(e.r),
          code: str(e.code, 12), boothTypeId: UUID.test(String(e.boothTypeId || '')) ? String(e.boothTypeId) : null,
          blocked: e.blocked === true,
        });
        break;
      case 'wall': {
        const pts = (Array.isArray(e.points) ? e.points : []).slice(0, MAX_WALL_POINTS)
          .filter((p) => Array.isArray(p) && p.length >= 2)
          .map(([x, y]) => [X(x), Y(y)]);
        if (pts.length >= 2) elements.push({ ...base, points: pts, closed: e.closed === true });
        break;
      }
      case 'door':
        elements.push({ ...base, x: X(e.x), y: Y(e.y), size: num(e.size, 10, 400, 40), r: R(e.r), double: e.double === true });
        break;
      case 'area':
        elements.push({
          ...base, x: X(e.x), y: Y(e.y), w: num(e.w, 10, 5000, 120), h: num(e.h, 10, 5000, 80), r: R(e.r),
          text: str(e.text, 40), sub: str(e.sub, 40), fill: hex(e.fill, '#0b4f8a'), textColor: hex(e.textColor, '#ffffff'),
        });
        break;
      case 'label': {
        const text = str(e.text, 60);
        if (text) elements.push({ ...base, x: X(e.x), y: Y(e.y), text, size: num(e.size, 8, 160, 22), color: hex(e.color, '#1f5fa8'), r: R(e.r) });
        break;
      }
      case 'arrow':
        elements.push({ ...base, x1: X(e.x1), y1: Y(e.y1), x2: X(e.x2), y2: Y(e.y2), color: hex(e.color, '#f4845f') });
        break;
      case 'table':
        elements.push({ ...base, x: X(e.x), y: Y(e.y), size: num(e.size, 10, 200, 30), seats: Math.round(num(e.seats, 0, 16, 8)) });
        break;
      case 'seats':
        elements.push({
          ...base, x: X(e.x), y: Y(e.y), rows: Math.round(num(e.rows, 1, 20, 5)), radius: num(e.radius, 20, 3000, 120),
          spread: num(e.spread, 10, 300, 120), r: R(e.r),
        });
        break;
      default:
        break;
    }
  }
  // ON THE SEAT MAP (2026-11-22): the booths are drawn on the event's venue map,
  // in its world (the plan's width and height are that world's). The venue
  // map editor writes such a plan — booths only — and every viewer draws the
  // seat map's room and tables underneath it.
  return input.onSeatMap === true ? { width, height, onSeatMap: true, elements } : { width, height, elements };
}

const boothsOf = (plan) => (plan?.elements || []).filter((e) => e.kind === 'booth');

/**
 * Each booth's state, for drawing it.
 *
 *   claims  [{ id, booth_key, stage, paid_at, business_name, category, listed }]
 *           the applications holding a booth (offered or confirmed)
 *   audience 'organizer' — every vendor's name, and which application
 *            'public'    — a vendor's name only once booked, paid and listed
 *            'vendor'    — as public, plus which booth is theirs (`mine`)
 *
 * → { [boothId]: { status: 'available' | 'held' | 'sold' | 'blocked', … } }
 */
function boothStatuses(plan, claims, { audience = 'public', mine = null } = {}) {
  const byKey = new Map((claims || []).filter((c) => c.booth_key).map((c) => [c.booth_key, c]));
  const out = {};
  for (const b of boothsOf(plan)) {
    const claim = byKey.get(b.id);
    let status = 'available';
    if (claim) status = claim.stage === 'confirmed' ? 'sold' : 'held';
    else if (b.blocked) status = 'blocked';
    const entry = { status };
    if (claim) {
      const showName = audience === 'organizer' || (claim.stage === 'confirmed' && claim.paid_at && claim.listed);
      if (showName) entry.vendor = { name: claim.business_name, category: claim.category || null };
      if (audience === 'organizer') entry.applicationId = claim.id;
    }
    if (mine && b.id === mine) entry.mine = true;
    out[b.id] = entry;
  }
  return out;
}

/** Booths a save would remove while an application still holds them. */
function removedClaimedBooths(nextPlan, claims) {
  const keep = new Set(boothsOf(nextPlan).map((b) => b.id));
  return (claims || []).filter((c) => c.booth_key && !keep.has(c.booth_key));
}

function findBooth(plan, key) {
  return boothsOf(plan).find((b) => b.id === key) || null;
}

module.exports = {
  KINDS, MAX_ELEMENTS, DEFAULT_SIZE, FloorPlanError, cleanPlan, boothsOf, boothStatuses, removedClaimedBooths, findBooth,
};
