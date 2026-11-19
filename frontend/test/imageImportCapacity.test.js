import { describe, test, expect } from 'vitest';
import { planToMap, encloseRoom } from '../src/app/components/seating/imageImport';
import { LADIES_NIGHT_PLAN } from './fixtures/ladiesNightPlan';
import { seatPositions, tableBody, toWorld, SEAT_RADIUS, tableScale, contentBounds } from '../src/app/components/seating/seatingGeometry';

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

describe('the room encloses what is in it (the Ladies Night reading, 2026-11-19)', () => {
  // The model's outline stopped at y = 70 %; rows of tables, T60 and the
  // entrance went on to y = 92 %. A door sat on that bottom wall.
  const plan = {
    ...PLAN,
    tables: [...PLAN.tables, box('T60', 50, 92, 14, 3, 10)],
    areas: [{ kind: 'entrance', label: 'Entrance', x: 15, y: 90, w: 8, h: 4, shape: 'rect', fill: null, border: 'solid' }],
    walls: [
      { x1: 10, y1: 25, x2: 90, y2: 25 },   // top
      { x1: 90, y1: 25, x2: 90, y2: 70 },   // right
      { x1: 90, y1: 70, x2: 10, y2: 70 },   // bottom, too high
      { x1: 10, y1: 70, x2: 10, y2: 25 },   // left
    ],
    doors: [{ label: 'Entrance', x: 20, y: 70, size: 6, vertical: false }],
    texts: [
      { text: 'Ladies Night', x: 50, y: 8, size: 4 },   // the poster's title
      { text: 'Dance floor', x: 50, y: 35, size: 2 },
    ],
  };
  const fixed = encloseRoom(plan);

  test('the bottom wall, and the side walls with it, move down past the last row', () => {
    const bottom = fixed.walls[2];
    expect(bottom.y1).toBeGreaterThanOrEqual(92 + 1.5);
    expect(fixed.walls[1].y2).toBe(bottom.y1);
    expect(fixed.walls[3].y1).toBe(bottom.y1);
    expect(fixed.walls[0].y1).toBe(25);   // the top was right, and stays
  });

  test('a door on the moved wall moves with it', () => {
    expect(fixed.doors[0].y).toBe(fixed.walls[2].y1);
  });

  test('words outside the room are dropped, words on the floor kept', () => {
    expect(fixed.texts.map((t) => t.text)).toEqual(['Dance floor']);
  });

  test('a plan with no outline is left alone', () => {
    expect(encloseRoom({ ...plan, walls: [] })).toEqual({ ...plan, walls: [] });
  });
});

describe('the Ladies Night plan rebuilds like the picture (2026-11-19: "very terrible, not real seats")', () => {
  const map = planToMap(LADIES_NIGHT_PLAN);
  const seatsOf = (t) => {
    const p = toWorld(t.position, map.world);
    const r = (p.rotation * Math.PI) / 180;
    const k = tableScale(t.style);
    return seatPositions(t.shape, t.seatCount, t.style).map((s) => ({
      t: t.label,
      x: p.x + (s.x * Math.cos(r) - s.y * Math.sin(r)) * k,
      y: p.y + (s.x * Math.sin(r) + s.y * Math.cos(r)) * k,
      r: SEAT_RADIUS * k,
    }));
  };

  test('every table arrives, with its printed seats, outlined and named in a readable colour', () => {
    expect(map.tables).toHaveLength(LADIES_NIGHT_PLAN.tables.length);
    expect(map.report.seats).toBe(LADIES_NIGHT_PLAN.tables.reduce((n, t) => n + t.capacity, 0));
    for (const t of map.tables) {
      expect(t.style.stroke).toBe('#c9a24a');
      expect(t.style.labelColor).toBe('#ffffff');
    }
  });

  test('tables are sized to their boxes instead of the room being spread: no seats overlap', () => {
    const pts = map.tables.flatMap(seatsOf);
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        if (pts[i].t === pts[j].t) continue;
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y), `${pts[i].t} / ${pts[j].t}`)
          .toBeGreaterThan(pts[i].r + pts[j].r - 1);
      }
    }
  });

  test('the room fills the frame: the walls are the edge of what is drawn', () => {
    const b = contentBounds(map.tables, map.zones, map.world);
    const walls = map.zones.filter((z) => z.kind === 'wall');
    const wallXs = walls.map((z) => (z.x / 100) * map.world.width);
    const span = Math.max(...wallXs) - Math.min(...wallXs);
    // Before: a wall reached half its length in every direction, and the
    // frame was about twice the room.
    expect(b.width).toBeLessThan(span * 1.15);
  });
});
