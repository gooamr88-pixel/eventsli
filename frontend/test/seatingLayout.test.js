import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { layoutPlan, footprint, placeZones, AISLE } from '../src/app/organizer/events/[id]/map/seatingLayout';
import { WORLD, SHAPES, toWorld } from '../src/app/components/seating/seatingGeometry';
import { ZONE_KINDS, zoneMeta } from '../src/app/components/seating/venueZones';

/**
 * The Seating Designer's placement. The AI only ever proposes a plan; this is
 * what turns it into positions, and what it must guarantee no matter the
 * plan: nothing overlaps, nothing leaves the room, the front is the front,
 * every table has its own name, and what did not fit is said out loud.
 */

const GALA = {
  sections: [
    { name: 'VIP', tableCount: 6, seatsPerTable: 10, shape: 'round', area: 'front', ticketType: 'VIP Table', tableCategory: null },
    { name: 'Guests', tableCount: 24, seatsPerTable: 10, shape: 'round', area: 'anywhere', ticketType: null, tableCategory: 'Family' },
  ],
  zones: [
    { kind: 'stage', label: null, position: 'front' },
    { kind: 'dance_floor', label: null, position: 'center' },
    { kind: 'bar', label: 'Bar', position: 'back' },
    { kind: 'bar', label: 'Bar', position: 'back' },
  ],
};
const LINKS = { tiers: [{ id: 'tier-vip', name: 'VIP table' }], categories: [{ id: 'cat-fam', name: 'family' }] };

/** A table's footprint box in world units, from where it was placed. */
function boxOf(t) {
  const { x, y } = toWorld(t.position);
  const { w, h } = footprint(t.shape, t.seatCount);
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
}
function zoneBox(z) {
  const { x, y } = toWorld(z.position);
  const w = z.overrides.w ?? zoneMeta(z.kind).w;
  const h = z.overrides.h ?? zoneMeta(z.kind).h;
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
}
const overlap = (a, b) => a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01;

describe('a gala', () => {
  const { tables, zones, report } = layoutPlan(GALA, LINKS);

  test('everything asked for is placed, and the report says so', () => {
    expect(report).toMatchObject({ wanted: 30, placed: 30, seats: 300, skippedZones: [] });
    expect(report.sections.map((s) => [s.name, s.placed])).toEqual([['VIP', 6], ['Guests', 24]]);
    expect(zones.map((z) => z.kind)).toEqual(['stage', 'dance_floor', 'bar', 'bar']);
  });

  test('no two tables overlap, and no table sits on a zone', () => {
    const boxes = tables.map(boxOf);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(overlap(boxes[i], boxes[j]), `${tables[i].label} × ${tables[j].label}`).toBe(false);
      for (const z of zones) expect(overlap(boxes[i], zoneBox(z)), `${tables[i].label} on the ${z.kind}`).toBe(false);
    }
  });

  test('nothing leaves the room', () => {
    for (const b of [...tables.map(boxOf), ...zones.map(zoneBox)]) {
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(WORLD.width);
      expect(b.y1).toBeLessThanOrEqual(WORLD.height);
    }
  });

  test('the front section is nearest the stage', () => {
    const y = (name) => tables.filter((t) => t.label.startsWith(name)).map((t) => t.position.y);
    expect(Math.max(...y('VIP'))).toBeLessThanOrEqual(Math.min(...y('Guests')));
    const stage = zones.find((z) => z.kind === 'stage');
    expect(stage.position.y).toBeLessThan(Math.min(...y('VIP')));
  });

  test('every table has its own name, and links only to this event’s own ticket type and category', () => {
    const labels = tables.map((t) => t.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(tables.filter((t) => t.label.startsWith('VIP')).every((t) => t.tierId === 'tier-vip')).toBe(true);
    expect(tables.filter((t) => t.label.startsWith('Guests')).every((t) => t.categoryId === 'cat-fam' && t.tierId === null)).toBe(true);
    expect(tables.every((t) => !('priceCents' in t))).toBe(true);
  });

  test('the same plan always gives the same map', () => {
    expect(layoutPlan(GALA, LINKS)).toEqual(layoutPlan(GALA, LINKS));
  });
});

test('a plan bigger than the room is placed as far as it goes, and the rest is reported', () => {
  const { report, tables } = layoutPlan({
    sections: [{ name: 'All', tableCount: 200, seatsPerTable: 10, shape: 'round', area: 'anywhere' }], zones: [],
  });
  expect(report.wanted).toBe(200);
  expect(report.placed).toBe(tables.length);
  expect(report.placed).toBeLessThan(200);
  // The fixed 1000 × 700 room (I-013) holds 40 round 10-tops with aisles.
  expect(report.placed).toBeGreaterThanOrEqual(35);
});

test('theatre rows face the stage and leave legroom between them', () => {
  const { tables } = layoutPlan({
    sections: [{ name: 'Rows', tableCount: 8, seatsPerTable: 20, shape: 'row', area: 'anywhere' }],
    zones: [{ kind: 'stage', position: 'front' }],
  });
  expect(tables).toHaveLength(8);
  const ys = [...new Set(tables.map((t) => t.position.y))].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i += 1) expect((ys[i] - ys[i - 1]) / 100 * WORLD.height).toBeGreaterThanOrEqual(30);
  expect(tables.every((t) => t.position.rotation === 0)).toBe(true);
});

test('left and right sections stay on their side, and back sections at the back', () => {
  const { tables } = layoutPlan({
    sections: [
      { name: 'Bride', tableCount: 4, seatsPerTable: 8, shape: 'round', area: 'left' },
      { name: 'Groom', tableCount: 4, seatsPerTable: 8, shape: 'round', area: 'right' },
      { name: 'Late', tableCount: 3, seatsPerTable: 8, shape: 'round', area: 'back' },
    ],
    zones: [],
  });
  const of = (n) => tables.filter((t) => t.label.startsWith(n));
  expect(of('Bride').every((t) => t.position.x < 50)).toBe(true);
  expect(of('Groom').every((t) => t.position.x > 50)).toBe(true);
  expect(of('Late').every((t) => t.position.y > 70)).toBe(true);
});

test('one section alone is numbered T1, T2… like the editor', () => {
  const { tables } = layoutPlan({ sections: [{ name: 'Dinner', tableCount: 3, seatsPerTable: 8, shape: 'rect', area: 'anywhere' }], zones: [] });
  expect(tables.map((t) => t.label)).toEqual(['T1', 'T2', 'T3']);
});

test('three bars at the back stand side by side', () => {
  const { zones, skipped } = placeZones([1, 2, 3].map(() => ({ kind: 'bar', position: 'back' })));
  expect(skipped).toEqual([]);
  const xs = zones.map((z) => z.position.x);
  expect(new Set(xs).size).toBe(3);
});

test('footprints include the chairs and an aisle', () => {
  const f = footprint('round', 10);
  expect(f.w).toBeGreaterThan(52 + AISLE);
});

test('the backend’s shape and zone lists are the frontend’s', () => {
  const src = fs.readFileSync(path.join(process.cwd(), '..', 'backend', 'services', 'ai', 'seatingDesigner.js'), 'utf8');
  const list = (name) => JSON.parse(src.match(new RegExp(`const ${name} = Object\\.freeze\\((\\[[\\s\\S]*?\\])\\)`))[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  expect(list('SHAPES')).toEqual([...SHAPES]);
  expect(list('ZONE_KINDS')).toEqual([...ZONE_KINDS]);
});
