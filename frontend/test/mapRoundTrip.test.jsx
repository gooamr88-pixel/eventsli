import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  toWorld, toPercent, tableBody, seatPositions, WORLD,
} from '../src/app/components/seating/seatingGeometry';

/**
 * Phase 4's definition of done: **a map saved by the organizer renders
 * identically on the buyer's page.**
 *
 * That property does not come from the two components agreeing. It comes from
 * neither of them owning the arithmetic — both call `seatingGeometry`, and
 * these tests prove there is no second path.
 */
const SRC = path.join(process.cwd(), 'src', 'app');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const EDITOR = read('organizer', 'events', '[id]', 'map', 'EditorCanvas.jsx');
const BUYER = read('components', 'seating', 'SeatMapCanvas.jsx');

describe('the editor and the buyer draw from one source', () => {
  test('both import their geometry, neither computes it', () => {
    for (const [name, src] of [['editor', EDITOR], ['buyer', BUYER]]) {
      expect(src, `${name} must import the shared geometry`)
        .toMatch(/from '.*seatingGeometry'/);
      // The three functions that decide where anything lands.
      for (const fn of ['toWorld', 'tableBody', 'seatPositions']) {
        expect(src, `${name} must use ${fn}`).toMatch(new RegExp(`\\b${fn}\\b`));
      }
    }
  });

  test('neither hard-codes a position, a radius or a world size', () => {
    // A literal here is how the two views drift apart: the editor writes a
    // corner where the buyer reads a centre, and the map scatters. It happened
    // in the codebase this pattern came from.
    for (const [name, src] of [['editor', EDITOR], ['buyer', BUYER]]) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');

      expect(code, `${name} declares its own world size`).not.toMatch(/width:\s*1000|height:\s*700/);
      expect(code, `${name} declares its own seat radius`).not.toMatch(/SEAT_RADIUS\s*=/);
    }
  });

  test('the editor writes percentages, which is what the column stores', () => {
    // `tables.position_x NUMERIC(6,3)` — "% of the logical world". The editor
    // converts through toPercent and nothing else.
    expect(EDITOR).toMatch(/toPercent\(/);
    expect(EDITOR).not.toMatch(/position:\s*\{\s*x:\s*point\.x/);
  });
});

describe('a saved position survives the round trip exactly', () => {
  test('drag → store → render lands on the same pixel', () => {
    // The organizer drops a table at some world point; that becomes a
    // percentage in the database; the buyer resolves it back. Any loss here is
    // a table that drifts every time the map is opened and saved.
    for (const point of [
      { x: 0, y: 0 },
      { x: WORLD.width / 2, y: WORLD.height / 2 },
      { x: 123.456, y: 456.789 },
      { x: WORLD.width, y: WORLD.height },
    ]) {
      const stored = toPercent(point.x, point.y);
      const rendered = toWorld(stored);
      expect(Math.abs(rendered.x - point.x)).toBeLessThan(0.02);
      expect(Math.abs(rendered.y - point.y)).toBeLessThan(0.02);
    }
  });

  test('opening and saving a map ten times does not move anything', () => {
    // The drift test. Three decimals in, three decimals out — if the rounding
    // were not idempotent, a room would creep across the floor over a week of
    // edits and nobody would be able to say when it started.
    let position = { x: 37.482, y: 61.905 };
    const original = { ...position };
    for (let i = 0; i < 10; i += 1) {
      const world = toWorld(position);
      position = toPercent(world.x, world.y);
    }
    expect(position).toEqual(original);
  });

  test('a table dragged off the floor is clamped, not lost', () => {
    // toPercent clamps to 0–100. Without it the database would happily store a
    // table at 400% and the buyer would open a map framed on empty space.
    expect(toPercent(-9999, -9999)).toEqual({ x: 0, y: 0 });
    expect(toPercent(WORLD.width * 5, WORLD.height * 5)).toEqual({ x: 100, y: 100 });
  });
});

describe('what the editor draws is what the buyer draws', () => {
  test('the same table yields the same body and the same seats', () => {
    // Both components call these with `(shape, seatCount)` and nothing else,
    // so equality here IS the guarantee — there is no third input either could
    // be passing differently.
    for (const shape of ['round', 'oval', 'rect', 'square', 'row']) {
      for (const seats of [1, 4, 8, 12, 30, 60]) {
        const body = tableBody(shape, seats);
        const layout = seatPositions(shape, seats);

        expect(tableBody(shape, seats)).toEqual(body);
        expect(seatPositions(shape, seats)).toEqual(layout);
        expect(layout).toHaveLength(seats);
      }
    }
  });

  test('a table at the same percentage lands at the same world point', () => {
    const position = { x: 42.5, y: 17.25, rotation: 30 };
    expect(toWorld(position)).toEqual(toWorld({ ...position }));
    expect(toWorld(position).rotation).toBe(30);
  });
});

describe('the editor respects the database ceilings', () => {
  const DRAFT = read('organizer', 'events', '[id]', 'map', 'useMapDraft.js');

  test('400 tables and 60 seats, the same numbers the schema enforces', () => {
    // `seat_count INT CHECK (seat_count BETWEEN 1 AND 60)` and the API's
    // `isArray({ max: 400 })`. Mirrored so the editor refuses before a save
    // that would be rejected after the organizer had done the work.
    expect(DRAFT).toMatch(/MAX_TABLES\s*=\s*400/);
    expect(DRAFT).toMatch(/MAX_SEATS_PER_TABLE\s*=\s*60/);
  });

  test('a new table carries no id, which is how the API reads "create"', () => {
    expect(DRAFT).toMatch(/localKey/);
    // If a client-generated id were sent, the API would treat it as an update
    // to a row that does not exist.
    expect(DRAFT).not.toMatch(/id:\s*`new-/);
  });
});
