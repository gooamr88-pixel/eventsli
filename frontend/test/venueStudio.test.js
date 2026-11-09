import { describe, test, expect } from 'vitest';
import {
  readStudio, writeStudio, liveSections, sectionIndex, seatName, tierPalette, TIER_COLORS, DEFAULT_SCENE,
} from '../src/app/components/venue/venueModel';
import { buildSceneModel, eyeFor, bestSeat, METRES_PER_UNIT } from '../src/app/components/venue/sceneModel';
import { buildSection } from '../src/app/organizer/events/[id]/map/studio/sectionBuilder';
import { SEAT_PITCH, seatPositions, toWorld } from '../src/app/components/seating/seatingGeometry';

/**
 * The Venue Studio's model: what it reads out of a layout blob nobody
 * validates, and the 3D room it lifts out of the 2D map.
 */
describe('readStudio — nothing malformed reaches a renderer', () => {
  test('an empty or hostile blob reads as a complete default', () => {
    for (const blob of [null, {}, { venue: 7, scene: 'x', views: {}, sections: 'y' }]) {
      const s = readStudio(blob);
      expect(s.scene).toEqual({ ...DEFAULT_SCENE });
      expect(s.views).toEqual([]);
      expect(s.sections).toEqual([]);
      expect(s.venue.type).toBe('arena');
    }
  });

  test('an image with a non-http URL is dropped, not drawn', () => {
    const s = readStudio({
      venue: { photo: { path: 'events/x/venue-1.jpg', url: 'javascript:alert(1)' } },
      views: [{ id: 'a', path: 'p', url: 'data:image/png;base64,xx' }, { id: 'b', path: 'p', url: 'https://cdn.test/p.jpg' }],
    });
    expect(s.venue.photo).toBeNull();
    expect(s.views.map((v) => v.id)).toEqual(['b']);
  });

  test('writeStudio keeps every key it does not own', () => {
    const layout = { world: { width: 1000 }, zones: [{ id: 'z' }], future: 1 };
    const out = writeStudio(layout, readStudio(layout));
    expect(out.zones).toEqual(layout.zones);
    expect(out.future).toBe(1);
    expect(out.scene).toEqual({ ...DEFAULT_SCENE });
  });
});

describe('sections name seats the way a buyer reads them', () => {
  const sections = [{ id: 's1', name: 'A1', rows: [{ table: 'A1 H', row: 'H' }, { table: 'Gone', row: 'J' }] }];

  test('a seat in a section is "Section · Row · Seat"; one outside it is its table', () => {
    const index = sectionIndex(sections);
    expect(seatName({ number: '17' }, 'A1 H', index)).toBe('Section A1 · Row H · Seat 17');
    expect(seatName({ number: '3' }, 'T4', index)).toBe('Table T4 · Seat 3');
  });

  test('rows whose table is gone fall out, and an empty section with them', () => {
    expect(liveSections(sections, [{ label: 'A1 H' }])[0].rows).toHaveLength(1);
    expect(liveSections(sections, [{ label: 'Other' }])).toEqual([]);
  });
});

test('ticket types are coloured most expensive first', () => {
  const tiers = [{ id: 'std', priceCents: 1000 }, { id: 'vip', priceCents: 9000 }];
  const palette = tierPalette(tiers, []);
  expect(palette.get('vip')).toBe(TIER_COLORS[0]);
  expect(palette.get('std')).toBe(TIER_COLORS[1]);
});

describe('the section builder', () => {
  test('rows are labelled, numbered and sized as asked, with unique table labels', () => {
    const { tables, section } = buildSection({
      name: 'B2', rows: 4, seatsPerRow: 10, addPerRow: 2, rowStart: 'A', origin: { x: 50, y: 50 }, existing: new Set(),
    });
    expect(tables.map((t) => t.label)).toEqual(['B2 A', 'B2 B', 'B2 C', 'B2 D']);
    expect(tables.map((t) => t.seatCount)).toEqual([10, 12, 14, 16]);
    expect(tables.every((t) => t.shape === 'row')).toBe(true);
    expect(section.rows.map((r) => r.row)).toEqual(['A', 'B', 'C', 'D']);
  });

  test('a wedge fans its rows to face the focus point', () => {
    const { tables } = buildSection({
      name: 'W', rows: 3, seatsPerRow: 8, layout: 'wedge', angle: 30, origin: { x: 50, y: 70 }, focus: { x: 50, y: 10 }, existing: new Set(),
    });
    // Each row is perpendicular to the line to the focus.
    for (const t of tables) expect(Math.abs(Math.abs(t.position.rotation) - 30)).toBeLessThan(0.01);
  });

  test('numbered rows, and a label already on the map, are handled', () => {
    const { tables } = buildSection({
      name: 'C', rows: 2, seatsPerRow: 4, rowStart: '1', origin: { x: 10, y: 10 }, existing: new Set(['c 1']),
    });
    expect(tables.map((t) => t.label)).toEqual(['C 1 (2)', 'C 2']);
  });

  test('seat counts stay within what the database accepts', () => {
    const { tables } = buildSection({ name: 'Z', rows: 30, seatsPerRow: 58, addPerRow: 4, origin: { x: 0, y: 0 }, existing: new Set() });
    expect(Math.max(...tables.map((t) => t.seatCount))).toBe(60);
  });
});

describe('the 3D room is the 2D map, lifted', () => {
  const stage = { id: 'st', kind: 'stage', x: 50, y: 10, w: 144, h: 60, rotation: 0 };
  const rows = [
    { id: 'r1', label: 'R1', shape: 'row', seatCount: 6, position: { x: 50, y: 40, rotation: 0 } },
    { id: 'r2', label: 'R2', shape: 'row', seatCount: 6, position: { x: 50, y: 70, rotation: 0 } },
  ];

  test('every seat is where the 2D map draws it, at real-world scale', () => {
    const m = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
    expect(m.seats).toHaveLength(12);
    const a = m.seats[0];
    const b = m.seats[1];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(SEAT_PITCH * METRES_PER_UNIT, 5);
    expect(SEAT_PITCH * METRES_PER_UNIT).toBeCloseTo(0.55, 5);
    // Same relative offset as the geometry says.
    const pts = seatPositions('row', 6);
    expect((b.x - a.x) / METRES_PER_UNIT).toBeCloseTo(pts[1].x - pts[0].x, 5);
    expect(toWorld(rows[0].position).y).toBeGreaterThan(0);
  });

  test('a rake raises the rows further from the stage, and only rows', () => {
    const table = { id: 't', label: 'T', shape: 'round', seatCount: 8, position: { x: 20, y: 90, rotation: 0 } };
    const m = buildSceneModel({ tables: [...rows, table], zones: [stage], scene: { rake: 20 } });
    const height = (id) => m.seats.find((s) => s.tableId === id).y;
    expect(height('r2')).toBeGreaterThan(height('r1'));
    expect(height('t')).toBe(0);
    expect(m.risers.length).toBeGreaterThan(0);
  });

  test('a seat’s eye looks at the stage, from a person’s height', () => {
    const m = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0, stageHeight: 1 } });
    const e = eyeFor(m.seats[3], m, { stageHeight: 1 });
    expect(e.position.y).toBeCloseTo(1.15, 5);
    expect(e.target.z).toBeLessThan(e.position.z);
  });

  test('the starting seat is an available one, away from the stage lip', () => {
    const m = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
    const best = bestSeat(m, (s) => s.tableId === 'r2');
    expect(best.tableId).toBe('r2');
  });
});
