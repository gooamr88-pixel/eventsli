import { describe, test, expect, beforeAll } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import {
  WORLD, MAX_WORLD, SEAT_PITCH, METRES_PER_UNIT,
  makeWorld, worldOf, worldMetres, worldFromMetres, screenScale, worldScale, unitsToPercent,
  toWorld, toPercent, moveToWorld, contentBounds, clampView, seatPositions,
} from '../src/app/components/seating/seatingGeometry';
import { readZones, writeZones } from '../src/app/components/seating/layoutZones';
import SeatMapCanvas from '../src/app/components/seating/SeatMapCanvas';
import FloorPlanFigure from '../src/app/organizer/events/[id]/map/print/FloorPlanFigure';
import { buildSceneModel } from '../src/app/components/venue/sceneModel';
import { buildSection, buildRing, nthSectionName } from '../src/app/organizer/events/[id]/map/studio/sectionBuilder';
import { layoutPlan } from '../src/app/organizer/events/[id]/map/seatingLayout';
import { frameFor } from '../src/app/organizer/events/[id]/map/mapApi';
import { useMapDraft, keyOf, MAX_TABLES } from '../src/app/organizer/events/[id]/map/useMapDraft';
import { VENUE_SIZES } from '../src/app/organizer/events/[id]/map/studio/VenueSizeCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PER-MAP WORLDS: a venue can be a stadium, and every old map is untouched.
 *
 * Positions are percentages of the map's world (`layout.world`). Seats keep
 * their size in units, so a bigger world is a bigger room. Two properties
 * matter and both are pinned here: an old map (no world, or the editor's fixed
 * 1000 × 700) draws exactly as it did, and a stadium-sized one can actually be
 * built — 5,000+ seats from the section builder, inside the API's ceilings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 560, width: 800, height: 560 };
  };
});

const STADIUM = makeWorld(8000, 5600);
const row = (label, x, y, seatCount = 10, rotation = 0) => ({
  id: label, label, shape: 'row', seatCount, position: { x, y, rotation },
});

/** Every seat's centre in world units, as the 2D map draws it. */
function seatPoints(tables, world) {
  return tables.flatMap((t) => {
    const p = toWorld(t.position, world);
    const r = (p.rotation * Math.PI) / 180;
    return seatPositions(t.shape, t.seatCount).map((pt) => ({
      x: p.x + pt.x * Math.cos(r) - pt.y * Math.sin(r),
      y: p.y + pt.x * Math.sin(r) + pt.y * Math.cos(r),
    }));
  });
}

describe('reading a world', () => {
  test('an old map — no world, the editor’s fixed one, or junk — is the default world itself', () => {
    expect(worldOf(undefined)).toBe(WORLD);
    expect(worldOf({})).toBe(WORLD);
    expect(worldOf({ world: { width: 1000, height: 700 } })).toBe(WORLD);
    expect(worldOf({ world: 'big' })).toBe(WORLD);
    expect(worldOf({ world: { width: 'x', height: 700 } })).toBe(WORLD);
  });

  test('a size is clamped, rounded and the same object every time', () => {
    expect(worldOf({ world: { width: 8000, height: 5600 } })).toBe(STADIUM);
    expect(makeWorld(100, 99999)).toEqual({ width: WORLD.width, height: MAX_WORLD.height });
    expect(makeWorld(4000.4, 2800.6)).toEqual({ width: 4000, height: 2801 });
    expect(Object.isFrozen(STADIUM)).toBe(true);
  });

  test('metres go both ways at 0.55 m a seat', () => {
    expect(SEAT_PITCH * METRES_PER_UNIT).toBeCloseTo(0.55, 9);
    expect(worldMetres(WORLD)).toEqual({ width: 22.9, depth: 16 });
    const m = worldMetres(STADIUM);
    expect(m.width).toBeGreaterThan(180);
    expect(worldFromMetres(m.width, m.depth)).toEqual(makeWorld(Math.round(m.width / METRES_PER_UNIT), Math.round(m.depth / METRES_PER_UNIT)));
    expect(worldMetres(MAX_WORLD).width).toBeGreaterThanOrEqual(200);
  });

  test('the presets keep the default’s shape, and the largest is a stadium', () => {
    expect(VENUE_SIZES[0].world).toBe(WORLD);
    for (const p of VENUE_SIZES) expect(p.world.width / p.world.height).toBeCloseTo(10 / 7, 2);
    expect(VENUE_SIZES.at(-1).world).toBe(STADIUM);
  });
});

describe('the default world behaves exactly as before', () => {
  test('every conversion with no world is the conversion in WORLD', () => {
    const p = { x: 37.125, y: 81.5, rotation: 30 };
    expect(toWorld(p)).toEqual(toWorld(p, WORLD));
    expect(toWorld(p)).toEqual({ x: 371.25, y: 570.5, rotation: 30 });
    expect(toPercent(371.25, 570.5)).toEqual({ x: 37.125, y: 81.5 });
    expect(screenScale({ width: WORLD.width })).toBe(1);
    expect(worldScale(WORLD)).toBe(1);
    expect(unitsToPercent(40, 0, WORLD).x).toBe(4);
  });

  test('the deepest zoom of a ballroom-sized frame is unchanged', () => {
    const b = { x: -55, y: -55, width: 1110, height: 810 };
    expect(clampView({ x: 0, y: 0, width: 1, height: 1 }, b).width).toBe(b.width / 24);
  });

  test('an old map draws byte-for-byte the same with its world read or left out', () => {
    const tables = [row('A', 30, 40), { id: 'T', label: 'T1', shape: 'round', seatCount: 8, position: { x: 60, y: 60, rotation: 0 } }];
    const zones = readZones({ zones: [{ id: 'z', kind: 'stage', x: 50, y: 10, w: 200, h: 60 }] });
    const a = render(<SeatMapCanvas tables={tables} seats={[]} zones={zones} />);
    const b = render(<SeatMapCanvas tables={tables} seats={[]} zones={zones} world={worldOf({ world: { width: 1000, height: 700 } })} />);
    expect(b.container.innerHTML).toBe(a.container.innerHTML);
  });
});

describe('a stadium-sized world', () => {
  test('a stored position means the same place in the room, read back from NUMERIC(6,3)', () => {
    const tables = [row('A', 50, 50, 40), row('B', 50, 51, 40)];
    const pts = seatPoints(tables, STADIUM);
    // Seats are still a pitch apart and rows ROW_GAP-ish apart: the room grew, the seats did not.
    expect(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)).toBeCloseTo(SEAT_PITCH, 6);
    // Three decimals of a percent is a tenth of a unit even at the maximum size.
    const p = toPercent(1234.56, 4321.09, MAX_WORLD);
    const back = toWorld(p, MAX_WORLD);
    expect(Math.abs(back.x - 1234.56)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(back.y - 4321.09)).toBeLessThanOrEqual(0.05);
  });

  test('content bounds, the editor frame and the deepest zoom follow the world', () => {
    expect(contentBounds([], [], STADIUM)).toEqual({ x: 0, y: 0, width: 8000, height: 5600 });
    const frame = frameFor([], [], STADIUM);
    expect(frame.width).toBeCloseTo(8000 * 1.1, 6);
    // Ten seats across, not a 24th of the bowl: a seat stays tappable on a phone.
    expect(clampView({ x: 0, y: 0, width: 1, height: 1 }, frame).width).toBe(SEAT_PITCH * 10);
  });

  test('zones may be as large as the world, and are clamped to it', () => {
    const big = readZones({ world: STADIUM, zones: [{ id: 'p', kind: 'stage', x: 50, y: 50, w: 5000, h: 3000 }] });
    expect(big[0]).toMatchObject({ w: 5000, h: 3000 });
    const small = readZones({ zones: [{ id: 'p', kind: 'stage', x: 50, y: 50, w: 5000, h: 3000 }] });
    expect(small[0]).toMatchObject({ w: WORLD.width, h: WORLD.height });
    expect(writeZones({ world: STADIUM }, big).zones[0]).toMatchObject({ w: 5000, h: 3000 });
  });

  test('the 3D model keeps 0.55 m a seat, so the bowl is stadium-sized in metres', () => {
    const tables = [row('A', 50, 30), row('B', 50, 70)];
    const m = buildSceneModel({ tables, zones: [], scene: { rake: 0 }, world: STADIUM });
    const a = m.seats[0];
    const b = m.seats[1];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.55, 5);
    const across = Math.abs(m.seats[10].z - m.seats[0].z);
    expect(across).toBeCloseTo(0.4 * 5600 * METRES_PER_UNIT, 3);
    expect(across).toBeGreaterThan(50);
  });

  test('the printed plan is the whole venue', () => {
    const { container } = render(
      <FloorPlanFigure tables={[row('A', 50, 50)]} zones={[]} widthMm={180} heightMm={120} world={STADIUM} />,
    );
    expect(container.querySelector('svg').getAttribute('viewBox')).toBe('0 0 8000 5600');
  });

  test('the Seating Designer lays a plan across the venue’s own floor', () => {
    const plan = { sections: [{ name: 'Floor', shape: 'round', seatsPerTable: 10, tableCount: 120, area: 'anywhere' }], zones: [] };
    expect(layoutPlan(plan).report.placed).toBeLessThan(120);
    const big = layoutPlan(plan, { world: makeWorld(4000, 2800) });
    expect(big.report.placed).toBe(120);
  });
});

describe('a 5,000+ seat bowl from the section builder', () => {
  const stage = { id: 'st', kind: 'stage', x: 50, y: 50, w: 600, h: 300, rotation: 0 };

  function bowl(world) {
    // The dialog's wedge origin: `distance` units in front of the stage.
    const distance = 1050;
    const origin = { x: 50, y: ((2800 + 150 + distance) / world.height) * 100 };
    return buildRing({
      name: 'A1', rows: 20, seatsPerRow: 24, addPerRow: 1, layout: 'wedge',
      copies: 12, spread: 30, angle: 0,
      origin, focus: { x: stage.x, y: stage.y }, existing: new Set(), world,
    });
  }

  test('twelve sections around the stage: 8,040 seats in 240 rows, all inside the venue', () => {
    const ring = bowl(STADIUM);
    const seats = ring.tables.reduce((n, t) => n + t.seatCount, 0);
    expect(seats).toBe(8040);
    expect(ring.tables).toHaveLength(240);
    expect(ring.tables.length).toBeLessThanOrEqual(MAX_TABLES);
    expect(ring.outside).toBe(0);
    expect(ring.sections.map((s) => s.name)).toEqual(
      ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
    );
    expect(new Set(ring.tables.map((t) => t.label.toLowerCase())).size).toBe(240);
    for (const t of ring.tables) {
      expect(t.position.x).toBeGreaterThan(0);
      expect(t.position.x).toBeLessThan(100);
      expect(t.position.y).toBeGreaterThan(0);
      expect(t.position.y).toBeLessThan(100);
    }
  });

  test('no two seats in the bowl overlap', () => {
    const pts = seatPoints(bowl(STADIUM).tables, STADIUM);
    const cell = SEAT_PITCH;
    const grid = new Map();
    let clashes = 0;
    for (const p of pts) {
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) {
            if (Math.hypot(p.x - q.x, p.y - q.y) < SEAT_PITCH * 0.9) clashes += 1;
          }
        }
      }
      const key = `${cx},${cy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
    expect(clashes).toBe(0);
  });

  test('the same bowl does not fit a ballroom, and the builder says so', () => {
    expect(bowl(WORLD).outside).toBeGreaterThan(0);
  });

  test('section names count on, and a single section is unchanged', () => {
    expect(nthSectionName('B9', 1)).toBe('B10');
    expect(nthSectionName('Upper', 2)).toBe('Upper 3');
    const one = buildSection({ name: 'B2', rows: 3, seatsPerRow: 8, origin: { x: 50, y: 50 }, existing: new Set() });
    const ring = buildRing({ name: 'B2', rows: 3, seatsPerRow: 8, origin: { x: 50, y: 50 }, existing: new Set() });
    expect(ring.tables.map((t) => t.position)).toEqual(one.tables.map((t) => t.position));
    expect(ring.sections[0].name).toBe('B2');
  });
});

describe('resizing the venue', () => {
  test('everything keeps its size and spacing in units, centred in the new floor', () => {
    const tables = [row('A', 40, 40), row('B', 40, 45)];
    const zones = [{ id: 'z', kind: 'stage', x: 50, y: 10, w: 200, h: 60, rotation: 0 }];
    const moved = moveToWorld({ tables, zones }, WORLD, STADIUM);
    const before = seatPoints(tables, WORLD);
    const after = seatPoints(moved.tables, STADIUM);
    const dx = (STADIUM.width - WORLD.width) / 2;
    const dy = (STADIUM.height - WORLD.height) / 2;
    after.forEach((p, i) => {
      expect(p.x - before[i].x).toBeCloseTo(dx, 0);
      expect(p.y - before[i].y).toBeCloseTo(dy, 0);
    });
    expect(toWorld({ x: moved.zones[0].x, y: moved.zones[0].y }, STADIUM).x).toBeCloseTo(500 + dx, 0);
    expect(moved.zones[0].w).toBe(200);
  });

  test('shrinking shifts content back inside, and refuses when it cannot fit', () => {
    const tables = [row('Edge', 2, 50, 10)];
    const back = moveToWorld({ tables, zones: [] }, STADIUM, WORLD);
    expect(back).not.toBeNull();
    for (const p of seatPoints(back.tables, WORLD)) expect(p.x).toBeGreaterThanOrEqual(0);

    const wide = [row('L', 5, 50, 10), row('R', 95, 50, 10)];
    expect(moveToWorld({ tables: wide, zones: [] }, STADIUM, WORLD)).toBeNull();
  });

  test('in the draft: one undo step, positions and size together', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([row('A', 40, 40)], [], WORLD); });
    const original = result.current.tables[0].position;

    let ok;
    act(() => { ok = result.current.resizeWorld(STADIUM); });
    expect(ok).toBe(true);
    expect(result.current.world).toBe(STADIUM);
    expect(result.current.dirty).toBe(true);
    expect(toWorld(result.current.tables[0].position, STADIUM).x).toBeCloseTo(400 + 3500, 0);

    // Later edits carry the world along rather than dropping it.
    const key = keyOf(result.current.tables[0]);
    act(() => { result.current.setPositions([{ kind: 'table', id: key, x: 10, y: 10 }]); });
    act(() => { result.current.rotateSelection({ tables: new Set([key]), zones: new Set() }, 90); });
    expect(result.current.world).toBe(STADIUM);

    act(() => { result.current.undo(); result.current.undo(); result.current.undo(); });
    expect(result.current.world).toBe(WORLD);
    expect(result.current.tables[0].position).toEqual(original);
    expect(result.current.dirty).toBe(false);
  });

  test('in the draft: a resize that cannot fit changes nothing', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([row('L', 5, 50), row('R', 95, 50)], [], STADIUM); });
    let ok;
    act(() => { ok = result.current.resizeWorld(WORLD); });
    expect(ok).toBe(false);
    expect(result.current.world).toBe(STADIUM);
    expect(result.current.canUndo).toBe(false);
  });

  test('a copy lands the same short step away in every venue', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([row('A', 50, 50)], [], STADIUM); });
    const key = keyOf(result.current.tables[0]);
    act(() => { result.current.duplicateSelection({ tables: new Set([key]), zones: new Set() }); });
    const [a, b] = result.current.tables.map((t) => toWorld(t.position, STADIUM));
    expect(b.x - a.x).toBeCloseTo(40, 0);
    expect(b.y - a.y).toBeCloseTo(28, 0);
  });
});
