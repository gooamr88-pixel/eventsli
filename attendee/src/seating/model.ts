/**
 * The seat map as the app draws it, built from the API's payload with the
 * WEBSITE'S OWN geometry (see metro.config.js for why it is imported, never
 * copied). Everything positional — where a table sits, where seat 7 is on a
 * D-shaped table, the world a stadium is measured in, the plate behind a
 * section — comes from those modules. This file only gathers the results into
 * one typed model the renderer and the hit-test share.
 */
import type { SeatMap } from '@/api/types';

import {
  boothZones, geometry, layoutZones, mapStyle, sectionPlates as plates, venueModel, venueZones,
  type Body, type Box, type Look, type Paint,
} from './shared';

export type { Body, Box };
export const SEAT_RADIUS = geometry.SEAT_RADIUS;
const {
  contentBounds, normaliseShape, seatPositions, tableBody, tableLabelSize, tableScale, toWorld, worldOf,
} = geometry;
export type MapSeat = SeatMap['seats'][number];
export type MapTable = SeatMap['tables'][number] & { style?: Record<string, unknown> | null };


export type Zone = {
  id: string; kind: string; label: string; x: number; y: number; w: number; h: number; rotation: number;
  color: string | null; shape?: string; fill?: string; fillOpacity?: number; showLabel?: boolean; code?: string;
};

export type PlacedSeat = {
  seat: MapSeat | null;
  tableId: string;
  /** World units, rotation and the table's scale already applied. */
  x: number;
  y: number;
  r: number;
  number: string;
  /** A chair round a table (always black), not a seat in a row. */
  atTable: boolean;
};

export type PlacedTable = {
  table: MapTable;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  body: Body;
  labelSize: number;
  paint: Paint;
};

export type MapModel = {
  world: { width: number; height: number };
  bounds: Box;
  zones: Zone[];
  tables: PlacedTable[];
  seats: PlacedSeat[];
  plates: { key: string; name: string; d: string; color: string }[];
  palette: Map<string, string>;
  /** More than one ticket type on the map: seats are coloured by type. */
  byTier: boolean;
  look: Look;
  /** "Section A · Row 3 · Seat 7", or "Table 4 · Seat 2". */
  nameOf: (seat: MapSeat) => string;
};

const sortSeats = (a: MapSeat, b: MapSeat) =>
  Number(a.number) - Number(b.number) || String(a.number).localeCompare(String(b.number));

/** The default colour of an open seat when every seat is the same type. */
export const OPEN_SEAT = '#17a2a6';

export function buildModel(data: SeatMap): MapModel | null {
  if (!data.map) return null;
  const layout = data.map.layout ?? null;
  const world = worldOf(layout);
  const look = mapStyle.readLook(layout);
  const tables: MapTable[] = mapStyle.withTableStyles(data.tables, layout);

  // Vendor booths drawn on this map are scenery to a buyer (boothZones.js).
  let zones = layoutZones.readZones(layout) as unknown as Zone[];
  const vb = data.vendorBooths;
  if (vb?.plan) {
    const booths = boothZones.boothsToZones(vb.plan, world, { withState: { states: vb.booths || {}, boothTypes: vb.boothTypes || [] } });
    zones = [...zones, ...(booths as unknown as Zone[])];
  }
  zones = venueZones.paintOrder(zones);

  const seatsByTable = new Map<string, MapSeat[]>();
  for (const s of data.seats) {
    if (!s.tableId) continue;
    const list = seatsByTable.get(s.tableId);
    if (list) list.push(s); else seatsByTable.set(s.tableId, [s]);
  }
  for (const list of seatsByTable.values()) list.sort(sortSeats);

  // THE MAP'S COLOUR RULES (the website's mapStyle.js): a table is its own
  // colour, then its category's or ticket type's, then the look's.
  const tint = venueModel.tableTint({ tiers: data.tiers, seats: data.seats, tables, categories: data.categories ?? [], look });
  const placedTables: PlacedTable[] = [];
  const placedSeats: PlacedSeat[] = [];
  for (const t of tables) {
    const pos = toWorld(t.position, world);
    const shape = normaliseShape(t.shape);
    const body = tableBody(shape, t.seatCount, t.style);
    const scale = tableScale(t.style);
    placedTables.push({
      table: t, x: pos.x, y: pos.y, rotation: pos.rotation, scale, body,
      labelSize: tableLabelSize(shape, body, t.style),
      paint: mapStyle.tablePaint(t, look, { fill: tint(t) }),
    });
    const rad = (pos.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const own = seatsByTable.get(t.id) ?? [];
    // Seat 1 is the geometry's index 0, so the number on the map is the one
    // on the ticket (SeatMapCanvas sorts the same way for the same reason).
    seatPositions(shape, t.seatCount, t.style).forEach((p, i) => {
      const seat = own[i] ?? null;
      placedSeats.push({
        seat,
        tableId: t.id,
        x: pos.x + (p.x * cos - p.y * sin) * scale,
        y: pos.y + (p.x * sin + p.y * cos) * scale,
        r: SEAT_RADIUS * scale,
        number: String(seat?.number ?? i + 1),
        atTable: body.kind !== 'none',
      });
    });
  }

  const palette = venueModel.tierPalette(data.tiers, data.seats, look);
  const byTier = new Set(data.seats.map((s) => s.tierId).filter(Boolean)).size > 1;
  const studio = venueModel.readStudio(layout);
  const sections = venueModel.liveSections(studio.sections, tables);
  const sectionPlates = plates.sectionPlates(sections, tables, (tableId: string) => {
    const tierId = seatsByTable.get(tableId)?.[0]?.tierId;
    return (byTier && tierId && palette.get(tierId)) || OPEN_SEAT;
  }, world);

  const index = venueModel.sectionIndex(sections);
  const labelOf = new Map(tables.map((t) => [t.id, t.label]));
  const nameOf = (seat: MapSeat) => {
    const label = seat.tableId ? labelOf.get(seat.tableId) : undefined;
    // A seat of a section row is addressed by its own section and row (S-19);
    // an older map falls back to the Studio's sections by table label.
    if (seat.section && label && seat.section !== label) return `Section ${seat.section} · Row ${seat.row} · Seat ${seat.number}`;
    const where = (label && index.get(label)) || (seat.section ? index.get(seat.section) : undefined);
    if (where) return `Section ${where.section} · Row ${where.row} · Seat ${seat.number}`;
    return `${label ? `Table ${label} · ` : ''}Seat ${seat.number}`;
  };

  return {
    world,
    bounds: contentBounds(tables, zones, world),
    zones,
    tables: placedTables,
    seats: placedSeats,
    plates: sectionPlates,
    palette,
    byTier,
    look,
    nameOf,
  };
}

/**
 * A viewBox of the container's aspect that holds `box` whole, centred — so a
 * map opens showing the entire room, the owner's rule for every screen size.
 */
export function fitView(box: Box, width: number, height: number): Box {
  const aspect = width / Math.max(height, 1);
  let w = box.width;
  let h = box.height;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
}

/**
 * Keeps a view over the content: no further out than the room plus margin, no
 * further in than about eight seats across, and never panned off the map.
 */
export function clampView(view: Box, bounds: Box, aspect: number): Box {
  const fit = fitView(bounds, aspect, 1);
  const minW = Math.min(fit.width, SEAT_RADIUS * 2 * 9);
  const maxW = fit.width * 1.25;
  const width = Math.min(maxW, Math.max(minW, view.width));
  const height = width / aspect;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  const clampC = (c: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, c)));
  const x = clampC(cx, bounds.x, bounds.x + bounds.width) - width / 2;
  const y = clampC(cy, bounds.y, bounds.y + bounds.height) - height / 2;
  return { x, y, width, height };
}

/**
 * The map's box changed size (the phone turned, the selection bar grew) after
 * the person had zoomed in: the same zoom (world units per point) and the
 * same centre in a box of the new size — never a jump back to the whole room
 * (owner, 2026-11-19: a map moves only when the person moves it).
 */
export function keepView(view: Box, beforeWidth: number, width: number, height: number, bounds: Box): Box {
  const k = view.width / beforeWidth;
  const w = width * k;
  const h = height * k;
  return clampView({ x: view.x + view.width / 2 - w / 2, y: view.y + view.height / 2 - h / 2, width: w, height: h }, bounds, width / height);
}

/**
 * What a tap at world point (x, y) lands on: the nearest seat within reach,
 * else the table body under it. `reach` is in world units (the screen's finger
 * size converted by the caller), and never smaller than the seat itself.
 */
export function hitTest(model: MapModel, x: number, y: number, reach: number):
  { kind: 'seat'; placed: PlacedSeat } | { kind: 'table'; table: PlacedTable } | null {
  let best: PlacedSeat | null = null;
  let bestD = Infinity;
  for (const p of model.seats) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD && d <= Math.max(reach, p.r * 1.4)) { best = p; bestD = d; }
  }
  if (best) return { kind: 'seat', placed: best };
  for (let i = model.tables.length - 1; i >= 0; i -= 1) {
    const t = model.tables[i];
    if (t.body.kind === 'none') continue;
    // Into the table's own frame: unrotate, unscale, then test its box.
    const rad = (-t.rotation * Math.PI) / 180;
    const dx = (x - t.x) / t.scale;
    const dy = (y - t.y) / t.scale;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hw = t.body.width / 2;
    const hh = t.body.height / 2;
    const inside = t.body.kind === 'ellipse' ? (lx * lx) / (hw * hw) + (ly * ly) / (hh * hh) <= 1 : Math.abs(lx) <= hw && Math.abs(ly) <= hh;
    if (inside) return { kind: 'table', table: t };
  }
  return null;
}
