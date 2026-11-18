/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A seating map read from a picture (2026-11-19) → the editor's own map.
 *
 * The AI (backend/services/ai/seatingFromImage.js) gives every table, area,
 * wall, door and floor label as a box in PERCENTAGES OF THE PICTURE. This file
 * places them, and the one decision that makes the result look like the
 * picture is the SCALE:
 *
 *   our tables have a real size (seats are 0.55 m apart, seatingGeometry), so
 *   the picture is scaled until its tables are, on the median, the size ours
 *   come out at. Every position is then the picture's position at that scale —
 *   the gaps, the aisles and the walls keep the picture's proportions exactly.
 *
 * Seats per side are kept as counted. A table drawn tall with its seats on the
 * left and right is turned 90° (our long tables run across), and a D-shape or
 * rounded-end table is turned so its curve faces the way the picture's does —
 * with the side counts turned with it, so seat 1 still sits where it was drawn.
 *
 * Pure: no React, no network — tested on plain plans.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  SHAPES, SEAT_RADIUS, makeWorld, seatPositions, tableBody, toPercent, worldScale,
} from './seatingGeometry';
import { SHAPE_SIDES } from './tableSides';
import { readZones, writeZones } from './layoutZones';
import { cleanLook, cleanHex } from './mapStyle';
import { MAX_ZONES } from './venueZones';

const MAX_TABLES = 400;
const CURVE_ROTATION = { right: 0, bottom: 90, left: 180, top: 270 };

/** World sides [top, right, bottom, left] → a table's own sides when it is turned `r` degrees. */
export function sidesForRotation(world, r) {
  const q = ((Math.round(r / 90) % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => world[(i + q) % 4]);
}

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One table of the plan → its shape, turn and seats, before placing. */
function tableShape(t) {
  const shape = SHAPES.includes(t.shape) ? t.shape : 'rect';
  const tall = t.h > t.w * 1.25;
  const allowed = SHAPE_SIDES[shape];
  if (!allowed) {
    // Round, oval, high-top, half-moon and rows: one count all the way round.
    const seatCount = Math.max(1, Math.min(60, t.around || t.sides.reduce((a, b) => a + b, 0)));
    const rotation = (shape === 'oval' || shape === 'row') && tall ? 90 : 0;
    return { shape, rotation, seatCount, sides: null };
  }
  let rotation = 0;
  if (shape === 'd_shape' || shape === 'rounded_end') rotation = CURVE_ROTATION[t.curve] ?? (tall ? 90 : 0);
  else if (shape !== 'square' && shape !== 'u_shape' && tall) rotation = 90;
  const local = sidesForRotation(t.sides, rotation);
  // A side this shape cannot seat (a U-shape's open bottom) gives its seats to the top.
  for (let i = 0; i < 4; i += 1) {
    if (!allowed.includes(i) && local[i]) { local[0] += local[i]; local[i] = 0; }
  }
  let seatCount = local.reduce((a, b) => a + b, 0);
  if (seatCount > 60) {
    const k = 60 / seatCount;
    for (let i = 0; i < 4; i += 1) local[i] = Math.floor(local[i] * k);
    seatCount = local.reduce((a, b) => a + b, 0);
  }
  if (seatCount < 1) { local[0] = 1; seatCount = 1; }
  return {
    shape, rotation, seatCount,
    sides: { top: local[0], right: local[1], bottom: local[2], left: local[3] },
  };
}

/** Half the width and height a table takes with its seats, turned as placed. */
function footprint(s) {
  const style = s.sides ? { sides: s.sides } : null;
  const body = tableBody(s.shape, s.seatCount, style);
  const pts = seatPositions(s.shape, s.seatCount, style);
  let hw = body.width / 2; let hh = body.height / 2;
  for (const p of pts) { hw = Math.max(hw, Math.abs(p.x) + SEAT_RADIUS); hh = Math.max(hh, Math.abs(p.y) + SEAT_RADIUS); }
  return s.rotation % 180 === 90 ? { hw: hh, hh: hw } : { hw, hh };
}

/** The smallest units-per-pixel at which no two tables (with seats) overlap. */
function clearance(shaped, imgW, imgH) {
  const items = shaped.map(({ t, s }) => ({ x: t.x / 100 * imgW, y: t.y / 100 * imgH, ...footprint(s) }));
  let need = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]; const b = items[j];
      const dx = Math.abs(a.x - b.x); const dy = Math.abs(a.y - b.y);
      const kx = dx > 0.5 ? (a.hw + b.hw + 2) / dx : Infinity;
      const ky = dy > 0.5 ? (a.hh + b.hh + 2) / dy : Infinity;
      const pair = Math.min(kx, ky);
      if (Number.isFinite(pair)) need = Math.max(need, pair);
    }
  }
  return need;
}

/** Unique, non-empty labels, as the API requires. */
function labeller() {
  const taken = new Set();
  let n = 0;
  return (wanted) => {
    let base = String(wanted || '').trim().slice(0, 36);
    if (!base) { do { n += 1; base = `T${n}`; } while (taken.has(base.toLowerCase())); }
    let label = base;
    for (let i = 2; taken.has(label.toLowerCase()); i += 1) label = `${base} (${i})`;
    taken.add(label.toLowerCase());
    return label;
  };
}

/**
 * The plan → `{ tables, zones, world, look, report }` for `useMapDraft.loadMap`.
 * `tables` are draft specs (label, shape, seatCount, position, style).
 */
export function planToMap(plan) {
  const imgW = Math.max(1, Number(plan?.image?.width) || 1600);
  const imgH = Math.max(1, Number(plan?.image?.height) || 1000);
  const px = (pct, side) => (Number(pct) || 0) / 100 * side;

  const shaped = (plan.tables || []).slice(0, MAX_TABLES).map((t) => ({ t, s: tableShape(t) }));

  // Units per picture pixel: the median of (our table's long side ÷ the drawn one's).
  const ratios = shaped.map(({ t, s }) => {
    const body = tableBody(s.shape, s.seatCount, s.sides ? { sides: s.sides } : null);
    const ours = Math.max(body.width, body.height);
    const drawn = Math.max(px(t.w, imgW), px(t.h, imgH));
    return drawn > 2 ? ours / drawn : null;
  }).filter((r) => r && Number.isFinite(r));
  const base = median(ratios) || 1000 / imgW;
  // Our seats are a fixed size, often larger beside a table than the dots in
  // a drawing: rows drawn close together would then overlap. So the scale
  // grows until no two tables' seats collide — but never past 1.6× the size
  // match, so one mis-measured table cannot blow the whole room up.
  let k = Math.max(base, Math.min(base * 1.6, clearance(shaped, imgW, imgH)));
  // The world has to be at least the default room and at most a stadium.
  k = Math.max(k, 1000 / imgW, 700 / imgH);
  k = Math.min(k, 10000 / imgW, 10000 / imgH);
  const world = makeWorld(Math.round(imgW * k), Math.round(imgH * k));
  const at = (x, y) => toPercent(px(x, imgW) * k, px(y, imgH) * k, world);
  const units = (pctW, side) => px(pctW, side) * k;

  const room = plan.room || {};
  const label = labeller();
  const tables = shaped.map(({ t, s }) => {
    const style = {};
    if (s.sides) style.sides = s.sides;
    const fill = cleanHex(t.fill);
    if (fill && fill !== cleanHex(room.table)) style.fill = fill;
    return {
      label: label(t.label),
      shape: s.shape,
      seatCount: s.seatCount,
      position: { ...at(t.x, t.y), rotation: s.rotation },
      style: Object.keys(style).length ? style : null,
    };
  });

  const thick = Math.min(20, Math.max(4, 6 * worldScale(world)));
  const zones = [];
  for (const a of plan.areas || []) {
    zones.push({
      kind: a.kind,
      label: a.label || '',
      ...at(a.x, a.y),
      w: units(a.w, imgW),
      h: units(a.h, imgH),
      rotation: 0,
      shape: a.kind === 'decor' ? 'rings' : a.shape,
      ...(a.fill ? { fill: a.fill, fillOpacity: 1 } : {}),
      strokeStyle: a.border || 'solid',
      ...(a.sublabel ? { sublabel: a.sublabel } : {}),
      showIcon: false,
      // A shape with no words in the picture has none on the map either.
      ...(a.label ? {} : { showLabel: false }),
    });
  }
  for (const w of plan.walls || []) {
    const x1 = px(w.x1, imgW) * k; const y1 = px(w.y1, imgH) * k;
    const x2 = px(w.x2, imgW) * k; const y2 = px(w.y2, imgH) * k;
    const len = Math.hypot(x2 - x1, y2 - y1);
    zones.push({
      kind: 'wall',
      ...toPercent((x1 + x2) / 2, (y1 + y2) / 2, world),
      w: len + thick,
      h: thick,
      rotation: ((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 360) % 360,
    });
  }
  for (const d of plan.doors || []) {
    zones.push({
      kind: 'door_gap', label: d.label || 'Door',
      ...at(d.x, d.y),
      w: Math.max(12, units(d.size, imgW)),
      h: thick + 4,
      rotation: d.vertical ? 90 : 0,
    });
  }
  for (const t of plan.texts || []) {
    const font = Math.max(8, units(t.size, imgH) / 0.7);
    zones.push({
      kind: 'text', label: t.text,
      ...at(t.x, t.y),
      w: Math.max(20, t.text.length * font * 0.62 + 10),
      h: Math.max(10, font / 0.62),
      rotation: 0,
    });
  }

  // Through the same reader and writer as a saved map: clamped, with ids.
  const clean = readZones(writeZones({ world }, zones.slice(0, MAX_ZONES).map((z, i) => ({ id: `img-${i}`, ...z }))))
    .map((z) => ({ ...z, id: `z_img_${Date.now().toString(36)}_${z.id}` }));

  const seatColors = (plan.seatColors || []).map(cleanHex).filter(Boolean);
  const look = cleanLook({
    floor: room.floor, wall: room.wall, table: room.table, label: room.label,
    seat: seatColors[0], accent: seatColors[1], font: 'bold',
  });

  return {
    tables,
    zones: clean,
    world,
    look,
    report: {
      tables: tables.length,
      seats: tables.reduce((n, t) => n + t.seatCount, 0),
      areas: (plan.areas || []).length,
      walls: (plan.walls || []).length,
      doors: (plan.doors || []).length,
      cut: (plan.tables || []).length > MAX_TABLES ? (plan.tables.length - MAX_TABLES) : 0,
    },
  };
}
