import { describe, test, expect } from 'vitest';
import { freeSpot } from '../src/app/organizer/events/[id]/map/mapApi';
import { makeZone } from '../src/app/components/seating/layoutZones';
import { toWorld, worldOf, seatPositions, SEAT_RADIUS } from '../src/app/components/seating/seatingGeometry';

/**
 * Where a stage, area or single seat lands when it is added (2026-11-21): the
 * middle of the view, moved to the nearest spot that covers nothing.
 */
const world = worldOf(null);   // 1000 × 700
const view = { x: 0, y: 0, width: 1000, height: 700 };
const size = { w: 120, h: 60 };

describe('freeSpot', () => {
  test('an empty view: the centre', () => {
    expect(freeSpot(view, size, [], [], world)).toEqual({ x: 50, y: 50 });
  });

  test('the centre taken by an area: the nearest free spot, not on top of it', () => {
    const stage = makeZone('stage', { x: 50, y: 50 }, { w: 200, h: 100 });
    const p = freeSpot(view, size, [], [stage], world);
    expect(p).not.toEqual({ x: 50, y: 50 });
    const c = toWorld(p, world);
    // Clear of the stage's box (400..600 × 300..400).
    const overlaps = c.x + size.w / 2 > 400 && c.x - size.w / 2 < 600 && c.y + size.h / 2 > 300 && c.y - size.h / 2 < 400;
    expect(overlaps).toBe(false);
  });

  test('the centre taken by a table and its seats: placed clear of every seat', () => {
    const t = { localKey: 't1', label: 'T1', shape: 'round', seatCount: 10, position: { x: 50, y: 50, rotation: 0 } };
    const c = toWorld(freeSpot(view, size, [t], [], world), world);
    const seats = seatPositions('round', 10).map((s) => ({ x: 500 + s.x, y: 350 + s.y }));
    const inside = seats.some((s) => Math.abs(s.x - c.x) < size.w / 2 + SEAT_RADIUS && Math.abs(s.y - c.y) < size.h / 2 + SEAT_RADIUS);
    expect(inside).toBe(false);
  });

  test('a long row counts as a row, not a huge square: the spot right beside it is free', () => {
    // A 22-seat row across the middle. A radius-based check blocked the whole
    // room and dropped the stage on top of the seats (2026-11-21).
    const row = { localKey: 'r1', label: 'A', shape: 'row', seatCount: 22, position: { x: 50, y: 50, rotation: 0 } };
    const c = toWorld(freeSpot(view, size, [row], [], world), world);
    expect(Math.abs(c.y - 350)).toBeLessThan(150);
    const seats = seatPositions('row', 22).map((s) => ({ x: 500 + s.x, y: 350 + s.y }));
    expect(seats.some((s) => Math.abs(s.x - c.x) < size.w / 2 + SEAT_RADIUS && Math.abs(s.y - c.y) < size.h / 2 + SEAT_RADIUS)).toBe(false);
  });

  test('a panned view: the middle of what is on screen', () => {
    const right = { x: 500, y: 350, width: 500, height: 350 };
    expect(freeSpot(right, size, [], [], world)).toEqual({ x: 75, y: 75 });
  });
});
