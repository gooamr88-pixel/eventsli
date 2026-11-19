import { describe, test, expect } from 'vitest';
import {
  TABLE_SCALE, tableScale, tableReach, contentBounds, toPercent, WORLD,
} from '../src/app/components/seating/seatingGeometry';
import { cleanTableStyle } from '../src/app/components/seating/mapStyle';
import { buildSceneModel } from '../src/app/components/venue/sceneModel';
import { seatPoints } from '../src/app/components/venue/sectionPlates';

/**
 * A table's drawn size (2026-11-19, the owner: "ability to resize the tables,
 * make them smaller to fit more tables"). Stored as `style.scale`, applied by
 * every view around the natural geometry.
 */
const at = (x, y) => ({ ...toPercent(x, y, WORLD), rotation: 0 });
const table = (scale) => ({
  id: `t${scale}`, label: 'T1', shape: 'round', seatCount: 10, position: at(500, 350),
  ...(scale ? { style: { scale } } : {}),
});

describe('tableScale', () => {
  test('defaults to 1 and is clamped to the range the panel offers', () => {
    expect(tableScale(null)).toBe(1);
    expect(tableScale({})).toBe(1);
    expect(tableScale({ scale: 'big' })).toBe(1);
    expect(tableScale({ scale: 0.7 })).toBe(0.7);
    expect(tableScale({ scale: 0.1 })).toBe(TABLE_SCALE.min);
    expect(tableScale({ scale: 9 })).toBe(TABLE_SCALE.max);
  });

  test('reach, and so framing and box-select, follow the size', () => {
    expect(tableReach(table(0.5))).toBeCloseTo(tableReach(table()) * 0.5, 5);
    const small = contentBounds([table(0.5)], [], WORLD);
    const normal = contentBounds([table()], [], WORLD);
    expect(small.width).toBeLessThan(normal.width);
  });

  test('section outlines hug the scaled seats', () => {
    const full = seatPoints(table());
    const half = seatPoints(table(0.5));
    const c = { x: 500, y: 350 };
    expect(Math.hypot(half[0].x - c.x, half[0].y - c.y))
      .toBeCloseTo(Math.hypot(full[0].x - c.x, full[0].y - c.y) * 0.5, 3);
  });
});

describe('the stored style', () => {
  test('keeps a size in range, rounded, and drops 100%', () => {
    expect(cleanTableStyle({ scale: 0.6 })).toEqual({ scale: 0.6 });
    expect(cleanTableStyle({ scale: 0.123456 })).toEqual({ scale: 0.5 });
    expect(cleanTableStyle({ scale: 1 })).toBeNull();
    expect(cleanTableStyle({ scale: 'x' })).toBeNull();
  });
});

describe('the 3D room', () => {
  test('a smaller table puts its chairs closer in, and sizes them to match', () => {
    const one = buildSceneModel({ tables: [table()] });
    const small = buildSceneModel({ tables: [table(0.5)] });
    const spread = (m) => Math.hypot(m.seats[0].x - m.bodies[0].x, m.seats[0].z - m.bodies[0].z);
    expect(spread(small)).toBeCloseTo(spread(one) * 0.5, 4);
    expect(small.bodies[0].w).toBeCloseTo(one.bodies[0].w * 0.5, 5);
    expect(small.seats[0].size).toBe(0.5);
    // A normal table carries no size at all: nothing changes for old maps.
    expect('size' in one.seats[0]).toBe(false);
  });

  test('every table body carries its name, for the number over it', () => {
    const m = buildSceneModel({ tables: [table()] });
    expect(m.bodies[0].label).toBe('T1');
  });
});
