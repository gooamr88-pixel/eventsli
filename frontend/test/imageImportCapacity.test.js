import { describe, test, expect } from 'vitest';
import { planToMap } from '../src/app/components/seating/imageImport';
import { seatPositions, tableBody, toWorld, SEAT_RADIUS } from '../src/app/components/seating/seatingGeometry';

/**
 * Plans that PRINT each table's capacity and draw no chairs (2026-11-19, the
 * owner's "Ladies Night" plan: boxes named T7, T8… with "8p", "14p" under
 * the name). 5 of ~45 tables used to arrive, because a table with no counted
 * seat dots was dropped as furniture.
 */
const box = (label, x, y, w, h, capacity, shape = 'rect') => ({
  label, shape, x, y, w, h, sides: [0, 0, 0, 0], around: 0, capacity, curve: null, fill: null,
});

const PLAN = {
  image: { width: 1300, height: 900 },
  room: {},
  tables: [
    box('T7', 31, 29, 10, 4, 8),
    box('T8', 31, 33, 12, 4, 14),
    box('T9', 31, 37, 12, 4, 14),
    box('T11', 31, 44, 5, 5, 10, 'square'),
    box('T13', 41, 53, 4, 5, 6, 'round'),
    box('T31', 81, 49, 3, 3, 2, 'square'),
    { ...box('T60', 51, 60, 14, 3, 0), guessed: true, capacity: 4 },
  ],
  areas: [], walls: [], doors: [], texts: [],
};

describe('a plan with printed capacities and no chairs', () => {
  const map = planToMap(PLAN);
  const by = new Map(map.tables.map((t) => [t.label, t]));

  test('every table arrives with the number printed on it', () => {
    expect(map.tables).toHaveLength(7);
    expect(by.get('T7').seatCount).toBe(8);
    expect(by.get('T8').seatCount).toBe(14);
    expect(by.get('T11').seatCount).toBe(10);
    expect(by.get('T13').seatCount).toBe(6);
    expect(by.get('T31').seatCount).toBe(2);
    expect(map.report.seats).toBe(8 + 14 + 14 + 10 + 6 + 2 + 4);
  });

  test('seats are spread the shape’s own way, not as counted sides', () => {
    expect(by.get('T8').style?.sides).toBeUndefined();
  });

  test('a table with no readable count is named in the report', () => {
    expect(map.report.guessed).toEqual(['T60']);
  });

  test('no two tables’ seats overlap', () => {
    const pts = map.tables.flatMap((t) => {
      const p = toWorld(t.position, map.world);
      const r = (p.rotation * Math.PI) / 180;
      return seatPositions(t.shape, t.seatCount, t.style).map((s) => ({
        t: t.label,
        x: p.x + s.x * Math.cos(r) - s.y * Math.sin(r),
        y: p.y + s.x * Math.sin(r) + s.y * Math.cos(r),
      }));
    });
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        if (pts[i].t === pts[j].t) continue;
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(SEAT_RADIUS * 2 - 0.5);
      }
    }
    expect(tableBody('rect', 14).width).toBeGreaterThan(0);
  });
});
