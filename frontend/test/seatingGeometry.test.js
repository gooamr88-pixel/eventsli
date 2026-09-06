import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORLD, SHAPES, SEAT_RADIUS, SEAT_PITCH,
  tableBody, seatPositions, toWorld, toPercent,
  contentBounds, clampView, normaliseShape,
} from '../src/app/components/seating/seatingGeometry';

/**
 * The contract test.
 *
 * Two jobs. The first is ordinary: prove the geometry is right. The second is
 * the reason the file says "ONE definition" at the top — prove nobody has
 * quietly made a second copy. A forked catalogue does not fail anywhere; it
 * just draws a buffet table as a round one in whichever view got left behind.
 */
describe('seatingGeometry — the contract', () => {
  test('nothing else in src re-implements the catalogue', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
        if (entry.name === 'seatingGeometry.js') continue;

        const src = fs.readFileSync(full, 'utf8');
        // A local shape list, or its own idea of how big a seat is. Either is a
        // second source of truth.
        const localCatalogue = /\[\s*'round'[^\]]*'oval'|SEAT_RADIUS\s*=\s*\d|const\s+SHAPES\s*=/.test(src);
        if (localCatalogue) offenders.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    };
    walk(root);

    expect(
      offenders,
      'These files define their own shape catalogue or seat size. Import from '
      + 'components/seating/seatingGeometry.js instead — that is the whole point of it.',
    ).toEqual([]);
  });

  test('the shapes are the ones the renderer can actually draw', () => {
    expect(SHAPES).toEqual(['round', 'oval', 'rect', 'square', 'row']);
    // Every shape must produce a body of a kind a renderer knows.
    for (const shape of SHAPES) {
      expect(['ellipse', 'rect', 'none']).toContain(tableBody(shape, 8).kind);
    }
  });

  test('an unknown shape degrades to round rather than to nothing', () => {
    // A map with one bad row should lose one table, not the whole room.
    expect(normaliseShape('hexagon')).toBe('round');
    expect(normaliseShape(undefined)).toBe('round');
    expect(tableBody('hexagon', 8)).toEqual(tableBody('round', 8));
  });
});

describe('seatingGeometry — seats', () => {
  test('every shape returns exactly the seats it was asked for', () => {
    for (const shape of SHAPES) {
      for (const n of [1, 2, 3, 5, 8, 12, 20, 60]) {
        expect(seatPositions(shape, n), `${shape} × ${n}`).toHaveLength(n);
      }
    }
  });

  test('the seat count is clamped to what the database accepts', () => {
    // `seat_count INT CHECK (seat_count BETWEEN 1 AND 60)`. A payload outside
    // that came from somewhere other than our editor.
    expect(seatPositions('round', 0)).toHaveLength(1);
    expect(seatPositions('round', -4)).toHaveLength(1);
    expect(seatPositions('round', 999)).toHaveLength(60);
  });

  test('seats never overlap, at any count, on any shape', () => {
    // The failure this prevents is a 20-seat round table drawn as a ring of
    // mush that nobody can click a single seat in. The table grows with the
    // count precisely so this holds.
    for (const shape of SHAPES) {
      for (const n of [4, 8, 12, 16, 24, 40, 60]) {
        const seats = seatPositions(shape, n);
        for (let i = 0; i < seats.length; i += 1) {
          for (let j = i + 1; j < seats.length; j += 1) {
            const d = Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y);
            expect(d, `${shape} × ${n}: seats ${i + 1} and ${j + 1} overlap`)
              .toBeGreaterThanOrEqual(SEAT_RADIUS * 2 - 0.01);
          }
        }
      }
    }
  });

  test('seats sit outside the table body, never on it', () => {
    for (const shape of ['round', 'oval', 'rect', 'square']) {
      const body = tableBody(shape, 10);
      for (const seat of seatPositions(shape, 10)) {
        const outside = Math.abs(seat.x) >= body.width / 2
          || Math.abs(seat.y) >= body.height / 2;
        expect(outside, `${shape}: a seat is drawn on top of the table`).toBe(true);
      }
    }
  });

  test('seat 1 is at the top of a round table, and they run clockwise', () => {
    // Matching how a person numbers a table when they walk up to it. Getting
    // this backwards is invisible on screen and wrong at the door.
    const seats = seatPositions('round', 4);
    expect(seats[0].y).toBeLessThan(0);
    expect(Math.abs(seats[0].x)).toBeLessThan(0.01);
    expect(seats[1].x).toBeGreaterThan(0);
    expect(seats[2].y).toBeGreaterThan(0);
    expect(seats[3].x).toBeLessThan(0);
  });

  test('a row is centred on its own position', () => {
    // Otherwise adding a seat slides the whole row sideways, which in an editor
    // reads as a bug rather than as an edit.
    for (const n of [2, 5, 10]) {
      const seats = seatPositions('row', n);
      const mid = seats.reduce((s, p) => s + p.x, 0) / n;
      expect(Math.abs(mid), `a row of ${n} is off-centre`).toBeLessThan(0.01);
      expect(seats.every((p) => p.y === 0)).toBe(true);
    }
  });
});

describe('seatingGeometry — coordinates', () => {
  test('positions are percentages of the world, per the schema', () => {
    // `position_x NUMERIC(6,3) -- % of the logical world`.
    expect(toWorld({ x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
    expect(toWorld({ x: 100, y: 100 })).toMatchObject({ x: WORLD.width, y: WORLD.height });
    expect(toWorld({ x: 50, y: 50 })).toMatchObject({ x: WORLD.width / 2, y: WORLD.height / 2 });
  });

  test('toPercent is the exact inverse of toWorld', () => {
    // A map opened and saved with nothing touched must not drift. Three
    // decimals, matching NUMERIC(6,3).
    for (const p of [{ x: 12.5, y: 80.25 }, { x: 0, y: 0 }, { x: 99.999, y: 33.333 }]) {
      const w = toWorld(p);
      expect(toPercent(w.x, w.y)).toEqual({ x: p.x, y: p.y });
    }
  });

  test('a malformed position resolves to the origin rather than to NaN', () => {
    // One NaN in an SVG transform blanks the entire drawing, not one table.
    for (const bad of [undefined, null, {}, { x: 'abc', y: null }]) {
      const w = toWorld(bad);
      expect(Number.isFinite(w.x) && Number.isFinite(w.y)).toBe(true);
    }
  });

  test('toPercent clamps to the storable range', () => {
    // NUMERIC(6,3) tops out well above 100, but a position outside 0–100 is off
    // the map by definition, and the database would happily store it.
    expect(toPercent(-500, -500)).toEqual({ x: 0, y: 0 });
    expect(toPercent(WORLD.width * 3, WORLD.height * 3)).toEqual({ x: 100, y: 100 });
  });
});

describe('seatingGeometry — the viewport', () => {
  const tables = [
    { position: { x: 10, y: 10 }, shape: 'round', seatCount: 8 },
    { position: { x: 30, y: 20 }, shape: 'rect', seatCount: 10 },
  ];

  test('bounds frame the content, not the empty room', () => {
    // A room mid-layout has every table in one corner. Framing the whole world
    // means the buyer opens on empty floor and has to pan to find the seats.
    const b = contentBounds(tables);
    expect(b.width).toBeLessThan(WORLD.width);
    expect(b.x).toBeGreaterThan(0);
  });

  test('an empty map still frames something', () => {
    expect(contentBounds([])).toEqual({ x: 0, y: 0, width: WORLD.width, height: WORLD.height });
    expect(contentBounds(null).width).toBe(WORLD.width);
  });

  test('bounds include the seats, not just the table bodies', () => {
    const one = [{ position: { x: 50, y: 50 }, shape: 'round', seatCount: 12 }];
    const b = contentBounds(one);
    const body = tableBody('round', 12);
    expect(b.width).toBeGreaterThan(body.width);
  });

  test('the view cannot be panned into the void', () => {
    // One trackpad flick and the map is gone, with nothing on screen to say
    // which way it went. This is the whole reason clampView exists.
    const b = contentBounds(tables);
    const lost = clampView({ x: 99999, y: 99999, width: 400, height: 300 }, b);
    expect(lost.x).toBeLessThan(b.x + b.width);
    expect(lost.y).toBeLessThan(b.y + b.height);
  });

  test('zoom is bounded in both directions', () => {
    const b = contentBounds(tables);
    expect(clampView({ x: 0, y: 0, width: 0.001, height: 0.001 }, b).width)
      .toBeGreaterThanOrEqual(b.width / 24);
    expect(clampView({ x: 0, y: 0, width: 1e9, height: 1e9 }, b).width)
      .toBeLessThanOrEqual(b.width * 1.6);
  });

  test('a map smaller than the minimum zoom centres instead of snapping', () => {
    // A one-table map. Math.min/max alone would jam it against an edge.
    const b = contentBounds([{ position: { x: 50, y: 50 }, shape: 'round', seatCount: 2 }]);
    const v = clampView({ x: 0, y: 0, width: b.width, height: b.height }, b);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
});
