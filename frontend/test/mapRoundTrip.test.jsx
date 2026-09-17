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

/**
 * THE EDITOR IS A DIRECTORY, NOT A FILE, and this test reads all of it.
 *
 * It used to read `EditorCanvas.jsx` alone, which was the whole editor at the
 * time. Once the editor grew a toolbar, a gesture machine, a zone renderer and
 * a print pack, that assertion stopped meaning what it says: the canvas could
 * pass while a sibling two directories over quietly re-derived a seat position.
 *
 * The property being defended has not changed — no surface may own the
 * arithmetic — so the scope widens to match the code rather than the check
 * narrowing to match one file. Anything added to the editor is covered the day
 * it is added, without anybody remembering to extend a list.
 */
const EDITOR_DIR = path.join(SRC, 'organizer', 'events', '[id]', 'map');

function readDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDir(full));
    else if (/\.jsx?$/.test(entry.name)) {
      out.push([path.relative(SRC, full).replace(/\\/g, '/'), fs.readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

const EDITOR_FILES = readDir(EDITOR_DIR);
const EDITOR = EDITOR_FILES.map(([, src]) => src).join('\n');
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

  test('no editor file re-derives a world size or a seat radius', () => {
    // A literal here is how the two views drift apart: the editor writes a
    // corner where the buyer reads a centre, and the map scatters. It happened
    // in the codebase this pattern came from. Checked per FILE rather than over
    // the concatenation, so a failure names the file that has to be fixed.
    for (const [name, src] of [...EDITOR_FILES, ['buyer', BUYER]]) {
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

  test('zones are drawn by the one shared renderer, on both sides', () => {
    // Same argument as the geometry, and the bug it prevents is the one this
    // catalogue's own header describes: three hand-copied versions drifted, and
    // a guest opening their chart saw the buffet drawn as a round TABLE.
    expect(EDITOR, 'the editor must render zones through ZoneShape').toMatch(/ZoneShape/);
    expect(BUYER, 'the buyer must render zones through ZoneShape').toMatch(/ZoneShape/);
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
  // The ceilings moved out of the draft hook and into the rule book beside it
  // when the draft grew zones and bulk operations. Where they are declared is
  // not the property under test — that they are declared once, and match the
  // schema, is.
  const RULES = read('organizer', 'events', '[id]', 'map', 'draftRules.js');

  test('400 tables and 60 seats, the same numbers the schema enforces', () => {
    // `seat_count INT CHECK (seat_count BETWEEN 1 AND 60)` and the API's
    // `isArray({ max: 400 })`. Mirrored so the editor refuses before a save
    // that would be rejected after the organizer had done the work.
    expect(RULES).toMatch(/MAX_TABLES\s*=\s*400/);
    expect(RULES).toMatch(/MAX_SEATS_PER_TABLE\s*=\s*60/);
    // Declared in exactly one place. A second copy is how the editor and the
    // API come to disagree about what fits.
    expect(DRAFT).not.toMatch(/MAX_TABLES\s*=\s*\d/);
    expect(DRAFT).not.toMatch(/MAX_SEATS_PER_TABLE\s*=\s*\d/);
  });

  test('a new table carries no id, which is how the API reads "create"', () => {
    expect(DRAFT).toMatch(/localKey/);
    // If a client-generated id were sent, the API would treat it as an update
    // to a row that does not exist.
    expect(DRAFT).not.toMatch(/id:\s*`new-/);
  });
});
