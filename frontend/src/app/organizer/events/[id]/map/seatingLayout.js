/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Seating Designer's plan → tables and zones at real positions.
 *
 * DETERMINISTIC, AND THE ONLY THING THAT PLACES ANYTHING (D-005). The AI says
 * "6 VIP round tables of 10 at the front, a dance floor in the centre"; this
 * file decides where each one goes. Same plan in, same map out, and no two
 * footprints ever overlap — which is the guarantee the model could not give.
 *
 * Sizes come from `seatingGeometry` (the one shape catalogue) and
 * `venueZones`, never from copies of them. A footprint is the table body plus
 * a ring of chairs plus an aisle, so a "fit" here is a room a waiter can walk.
 *
 * THE ROOM IS THE WORLD (I-013): the map's own world (1000 × 700 units unless
 * the venue was made bigger: seatingGeometry.worldOf), front (the stage side) at
 * the top. A plan bigger than the world is laid out as far as it goes and the
 * rest is REPORTED — "placed 38 of 42" — never silently dropped.
 *
 * Pure: plan in, `{ tables, zones, report }` out, ready for
 * `useMapDraft.replaceLayout` as one undo step.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { SEAT_RADIUS, tableBody, toPercent, worldOf } from '../../../../components/seating/seatingGeometry';

const DEFAULT_WORLD = worldOf(null);
import { zoneMeta } from '../../../../components/seating/venueZones';

export const MARGIN = 24;
/** Between two footprints: an aisle, in world units. */
export const AISLE = 14;
/** How far down the room the packer looks for the next row. */
const SCAN_STEP = 8;
const MAX_LABEL = 20;

/** Bigger than the editor's defaults: these anchor a whole room. */
const ZONE_SIZE = Object.freeze({ stage: { w: 260, h: 70 }, dance_floor: { w: 170, h: 150 } });

/** The space one table really needs: body, chairs all round, and an aisle. */
export function footprint(shape, seats) {
  const body = tableBody(shape, seats);
  if (shape === 'row') return { w: body.width + AISLE, h: SEAT_RADIUS * 2 + 22 };
  const ring = (SEAT_RADIUS * 2 + 4) * 2;
  return { w: body.width + ring + AISLE, h: body.height + ring + AISLE };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const box = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });

// ─── Zones ─────────────────────────────────────────────────────────────────
function anchor(position, w, h, world) {
  const { width: W, height: H } = world;
  const left = MARGIN + w / 2;
  const right = W - MARGIN - w / 2;
  const top = MARGIN + h / 2;
  const bottom = H - MARGIN - h / 2;
  return {
    front: [W / 2, top], back: [W / 2, bottom], left: [left, H / 2], right: [right, H / 2], center: [W / 2, H / 2],
    'front-left': [left, top], 'front-right': [right, top], 'back-left': [left, bottom], 'back-right': [right, bottom],
  }[position] || [W / 2, H / 2];
}

/**
 * Zones at their anchors. Several at one anchor are spread along that edge —
 * three bars "at the back" stand side by side, not on top of each other. A
 * zone that would still collide is left out and reported.
 */
export function placeZones(planZones = [], world = DEFAULT_WORLD) {
  const groups = new Map();
  planZones.forEach((z) => groups.set(z.position, [...(groups.get(z.position) || []), z]));

  const placed = [];
  const boxes = [];
  const fronts = [];
  const skipped = [];
  for (const [position, list] of groups) {
    const sizes = list.map((z) => ZONE_SIZE[z.kind] || { w: zoneMeta(z.kind).w, h: zoneMeta(z.kind).h });
    const vertical = position === 'left' || position === 'right';
    const span = sizes.reduce((sum, s) => sum + (vertical ? s.h : s.w) + 20, -20);
    let cursor = -span / 2;
    list.forEach((z, i) => {
      const { w, h } = sizes[i];
      const [ax, ay] = anchor(position, w, h, world);
      const offset = cursor + (vertical ? h : w) / 2;
      cursor += (vertical ? h : w) + 20;
      const cx = vertical ? ax : ax + offset;
      const cy = vertical ? ay + offset : ay;
      const b = box(cx, cy, w + 16, h + 16);
      const inside = cx - w / 2 >= 0 && cx + w / 2 <= world.width && cy - h / 2 >= 0 && cy + h / 2 <= world.height;
      if (!inside || boxes.some((o) => overlaps(o, b))) { skipped.push(z.kind); return; }
      boxes.push(b);
      if (position.startsWith('front')) fronts.push(b);
      const pct = toPercent(cx, cy, world);
      placed.push({
        kind: z.kind,
        label: z.label || '',
        position: { x: pct.x, y: pct.y },
        overrides: ZONE_SIZE[z.kind] ? { w, h } : {},
      });
    });
  }
  return { zones: placed, boxes, fronts, skipped };
}

// ─── Tables ────────────────────────────────────────────────────────────────
/** Front first, then the open floor, the back last (packed from the back wall forwards). */
const ORDER = { front: 0, left: 1, right: 1, middle: 2, anywhere: 2, back: 3 };

function xRange(area, world) {
  const { width: W } = world;
  if (area === 'left') return [MARGIN, W / 2 - AISLE / 2];
  if (area === 'right') return [W / 2 + AISLE / 2, W - MARGIN];
  return [MARGIN, W - MARGIN];
}

/** Row by row from the front (or the back), centred, skipping anything in the way. */
function packSection(section, obstacles, world) {
  const { w, h } = footprint(section.shape, section.seatsPerTable);
  const [x0, x1] = xRange(section.area, world);
  const perRow = Math.max(0, Math.floor((x1 - x0 + 0.001) / w));
  const out = [];
  if (perRow === 0) return out;

  const fromBack = section.area === 'back';
  const first = fromBack ? world.height - MARGIN - h / 2 : MARGIN + h / 2;
  const last = fromBack ? MARGIN + h / 2 : world.height - MARGIN - h / 2;
  const step = fromBack ? -1 : 1;
  // Centre seats first: a section smaller than a row sits in the middle,
  // facing the stage, and the next section takes the ends.
  const mid = (x0 + x1) / 2;
  const xs = Array.from({ length: perRow }, (_, i) => mid + (i - (perRow - 1) / 2) * w)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);

  for (let y = first; fromBack ? y >= last : y <= last;) {
    let any = false;
    for (const x of xs) {
      if (out.length === section.tableCount) break;
      const b = box(x, y, w, h);
      if (obstacles.some((o) => overlaps(o, b))) continue;
      obstacles.push(b);
      out.push({ x, y });
      any = true;
    }
    if (out.length === section.tableCount) break;
    y += step * (any ? h : SCAN_STEP);
  }
  return out;
}

/** "VIP" → "VIP 1", "VIP 2"…; one section alone is numbered T1, T2… like the editor. */
function labeller(sections) {
  const taken = new Set();
  const single = sections.length === 1;
  return (section) => {
    const stem = single ? 'T' : `${String(section.name || 'Table').trim().slice(0, MAX_LABEL - 4)} `;
    for (let n = 1; n < 1000; n += 1) {
      const label = `${stem}${n}`;
      if (!taken.has(label.toLowerCase())) { taken.add(label.toLowerCase()); return label; }
    }
    return `${stem}${Date.now()}`;
  };
}

const byName = (list, name) => (name ? (list || []).find((x) => String(x.name).trim().toLowerCase() === String(name).trim().toLowerCase()) : null);

/**
 * @param {object} plan        `{ sections, zones }` from the API (`validatePlan`)
 * @param {object} [links]     `{ tiers: [{id,name}], categories: [{id,name}], world }` of THIS event
 * @returns {{ tables: object[], zones: object[], report: object }}
 */
export function layoutPlan(plan, { tiers = [], categories = [], world = DEFAULT_WORLD } = {}) {
  const sections = (plan?.sections || []).map((s, i) => ({ ...s, index: i }))
    .sort((a, b) => (ORDER[a.area] ?? 2) - (ORDER[b.area] ?? 2) || a.index - b.index);
  const { zones, boxes, fronts, skipped } = placeZones(plan?.zones || [], world);
  // Nothing sits BESIDE the stage: the band level with a front zone is kept
  // clear across the room. Those corners face the side of the stage, and a
  // table there would be "nearer the front" than the VIP rows behind it.
  const obstacles = [...boxes, ...fronts.map((b) => ({ x0: 0, x1: world.width, y0: 0, y1: b.y1 }))];
  const label = labeller(sections);

  const tables = [];
  const perSection = [];
  for (const section of sections) {
    const spots = packSection(section, obstacles, world);
    const tierId = byName(tiers, section.ticketType)?.id ?? null;
    const categoryId = byName(categories, section.tableCategory)?.id ?? null;
    for (const spot of spots) {
      const pct = toPercent(spot.x, spot.y, world);
      tables.push({
        label: label(section),
        seatCount: section.seatsPerTable,
        shape: section.shape,
        tierId,
        categoryId,
        position: { x: pct.x, y: pct.y, rotation: 0 },
      });
    }
    perSection.push({
      name: section.name, wanted: section.tableCount, placed: spots.length, seats: section.seatsPerTable, shape: section.shape,
      ticketType: tierId ? section.ticketType : null,
    });
  }
  // Numbered in the order the organizer listed the sections, which is how
  // they will read them back, while the PLACING order was front-to-back.
  const wanted = perSection.reduce((n, s) => n + s.wanted, 0);
  return {
    tables,
    zones,
    report: {
      sections: [...perSection].sort((a, b) => plan.sections.findIndex((s) => s.name === a.name) - plan.sections.findIndex((s) => s.name === b.name)),
      wanted,
      placed: tables.length,
      seats: tables.reduce((n, t) => n + t.seatCount, 0),
      skippedZones: skipped,
    },
  };
}
