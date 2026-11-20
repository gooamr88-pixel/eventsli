/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The vendor floor plan's model (2026-11-20) — the colours, the new-element
 * factories and the geometry the renderer, the editor and the viewer share.
 *
 * The look is the owner's reference floor plans: an orange wall outline with
 * door swings; grey booths with a pink SOLD rosette, or a pink "no entry"
 * circle when unavailable; free booths in their category colour with a code
 * (DB1, DB2…); a blue stage block and a green restaurant block with white
 * capitals; round tables ringed with chairs; an arc of theatre seats facing
 * the stage; thick orange traffic arrows; a blue "Lobby" label.
 *
 * The server rebuilds every element on save (backend/services/vendorFloorPlan.js),
 * so the bounds here are for the editor's comfort, not for safety.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const INK = {
  wall: '#f4845f',
  boothTaken: '#8f8f8f',
  boothFree: '#e7e7ec',
  boothStroke: '#1d1d1f',
  pink: '#d4157a',
  label: '#1f5fa8',
  furniture: '#5b5b63',
  selected: '#1a73e8',
  mine: '#d61f2c',
};

/** Colours offered for booth types and areas, in the reference's spirit. */
export const BOOTH_COLORS = ['#18a8e8', '#9b59b6', '#f26522', '#21b05c', '#f5c518', '#e84393', '#00b8a9', '#5c6bc0'];
export const AREA_COLORS = ['#0b4f8a', '#16a34a', '#d61f2c', '#111018', '#f26522', '#7c3aed', '#0e7490', '#a16207'];

export const DEFAULT_PLAN = Object.freeze({ width: 1200, height: 800, elements: [] });

let counter = 0;
export function newId(kind) {
  counter += 1;
  return `${kind[0]}${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 40);
}

/** A new element of `kind`, centred on a world point. */
export function makeElement(kind, at, extra = {}) {
  const x = Math.round(at.x);
  const y = Math.round(at.y);
  switch (kind) {
    case 'booth': return { id: newId('booth'), kind, x: x - 30, y: y - 30, w: 60, h: 60, r: 0, code: '', boothTypeId: null, blocked: false, ...extra };
    case 'door': return { id: newId('door'), kind, x, y, size: 40, r: 0, double: false, ...extra };
    case 'area': return { id: newId('area'), kind, x: x - 60, y: y - 50, w: 120, h: 100, r: 0, text: 'stage', sub: '', fill: AREA_COLORS[0], textColor: '#ffffff', ...extra };
    case 'label': return { id: newId('label'), kind, x, y, text: 'Lobby', size: 24, color: INK.label, r: 0, ...extra };
    case 'arrow': return { id: newId('arrow'), kind, x1: x - 50, y1: y, x2: x + 50, y2: y, color: INK.wall, ...extra };
    case 'table': return { id: newId('table'), kind, x, y, size: 26, seats: 8, ...extra };
    case 'seats': return { id: newId('seats'), kind, x, y, rows: 6, radius: 70, spread: 140, r: 0, ...extra };
    case 'wall': return { id: newId('wall'), kind, points: [[x, y]], closed: false, ...extra };
    default: throw new Error(`unknown kind ${kind}`);
  }
}

/** "DB" + 7 → "DB7"; the next free number after the highest with that prefix. */
export function nextCode(elements, prefix) {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`, 'i');
  let max = 0;
  for (const e of elements) {
    if (e.kind !== 'booth') continue;
    const m = String(e.code || '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * A row of booths side by side, touching, as in the reference: `count` booths
 * of `w`×`h`, numbered `prefix`+n from `start`, running right or down.
 */
export function makeRow({ at, count, w, h, direction = 'right', prefix = '', start = 1, gap = 0, boothTypeId = null }) {
  const n = Math.max(1, Math.min(60, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => ({
    ...makeElement('booth', { x: 0, y: 0 }),
    x: Math.round(at.x + (direction === 'right' ? i * (w + gap) : 0)),
    y: Math.round(at.y + (direction === 'down' ? i * (h + gap) : 0)),
    w, h, code: prefix || start > 1 || count > 1 ? `${prefix}${start + i}` : '', boothTypeId,
  }));
}

/** Where an element's handle sits (its own origin), for moving it. */
export function anchorOf(e) {
  if (e.kind === 'wall') return { x: e.points[0][0], y: e.points[0][1] };
  if (e.kind === 'arrow') return { x: e.x1, y: e.y1 };
  return { x: e.x, y: e.y };
}

/** The same element, moved by (dx, dy). */
export function moveBy(e, dx, dy) {
  if (e.kind === 'wall') return { ...e, points: e.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]) };
  if (e.kind === 'arrow') return { ...e, x1: Math.round(e.x1 + dx), y1: Math.round(e.y1 + dy), x2: Math.round(e.x2 + dx), y2: Math.round(e.y2 + dy) };
  return { ...e, x: Math.round(e.x + dx), y: Math.round(e.y + dy) };
}

/** A rough box around an element, for marquee selection and framing. */
export function boxOf(e) {
  switch (e.kind) {
    case 'booth':
    case 'area': return { x: e.x, y: e.y, w: e.w, h: e.h };
    case 'wall': {
      const xs = e.points.map((p) => p[0]); const ys = e.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'arrow': return { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    case 'table': return { x: e.x - e.size, y: e.y - e.size, w: e.size * 2, h: e.size * 2 };
    case 'seats': { const r = e.radius + e.rows * 16; return { x: e.x - r, y: e.y - r, w: r * 2, h: r * 2 }; }
    case 'door': return { x: e.x - e.size, y: e.y - e.size, w: e.size * 2, h: e.size * 2 };
    case 'label': return { x: e.x - e.text.length * e.size * 0.3, y: e.y - e.size, w: e.text.length * e.size * 0.6, h: e.size * 1.2 };
    default: return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Dark text on light fills, white on dark — so a code reads on any category colour. */
export function textOn(fill) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(fill || ''));
  if (!m) return '#111018';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.18 ? '#111018' : '#ffffff';
}

/** A booth type's colour, or a stable one from the palette by its position. */
export function typeColor(boothTypes, id) {
  if (!id) return INK.boothFree;
  const i = boothTypes.findIndex((t) => t.id === id);
  if (i < 0) return INK.boothFree;
  return boothTypes[i].color || BOOTH_COLORS[i % BOOTH_COLORS.length];
}

/** A starter plan for an empty event: the hall outline and its entrance. */
export function starterPlan() {
  const w = 1200; const h = 800;
  return {
    width: w,
    height: h,
    elements: [
      { id: newId('wall'), kind: 'wall', points: [[20, 20], [1180, 20], [1180, 700], [1080, 780], [20, 780]], closed: true },
      { id: newId('door'), kind: 'door', x: 560, y: 780, size: 40, r: 180, double: true },
      { id: newId('label'), kind: 'label', x: 600, y: 740, text: 'Entrance', size: 24, color: INK.label, r: 0 },
    ],
  };
}
