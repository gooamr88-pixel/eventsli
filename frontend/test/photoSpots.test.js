import { describe, test, expect } from 'vitest';
import { buildSceneModel } from '../src/app/components/venue/sceneModel';
import {
  projectSeats, spotToScene, sceneToSpot, direction, guessSpot, DEFAULT_PHOTO_HEIGHT,
} from '../src/app/components/venue/photoSpots';
import { worldOf } from '../src/app/components/seating/seatingGeometry';

/**
 * A dot on a 360° photo is a promise that this chair is that seat. These
 * tests hold the projection to the 3D room the other views draw, so the dot
 * a buyer taps is the seat that goes in the basket.
 */
const room = () => buildSceneModel({
  tables: [
    { id: 'A', label: 'A', shape: 'row', seatCount: 10, position: { x: 50, y: 50, rotation: 0 } },
    { id: 'B', label: 'B', shape: 'row', seatCount: 10, position: { x: 50, y: 60, rotation: 0 } },
  ],
  zones: [{ id: 's', kind: 'stage', x: 40, y: 20, w: 20, h: 8, rotation: 0 }],
  scene: { rake: 0 },
  world: worldOf(null),
});

const deg = (r) => (r * 180) / Math.PI;

describe('projectSeats', () => {
  test('with heading set so the photo is aligned to the room, each dot looks straight at its seat', () => {
    const model = room();
    const spot = { x: 30, y: 70, h: 1.5 };
    const p = spotToScene(model, spot);
    // The heading that makes photo yaw equal room yaw: the stage's own yaw.
    const stageYaw = Math.atan2(-(model.focus.x - p.x), -(model.focus.z - p.z));
    const view = { heading: deg(stageYaw), tables: ['A', 'B'], spot };
    for (const { entry, yaw, pitch } of projectSeats(model, view)) {
      const d = direction(yaw, pitch);
      const flat = Math.hypot(entry.x - p.x, entry.z - p.z);
      expect(d.x / Math.cos(pitch)).toBeCloseTo((entry.x - p.x) / flat, 6);
      expect(d.z / Math.cos(pitch)).toBeCloseTo((entry.z - p.z) / flat, 6);
    }
  });

  test('the stage sits at the heading, and a seat to the left is at a larger yaw', () => {
    const model = room();
    const spot = guessSpot(model, ['B']);
    const view = { heading: 30, tables: ['A'], spot };
    const seats = projectSeats(model, view);
    // Row A runs left to right across the stage's line of sight: its lowest
    // seat number is drawn at the left of the map.
    const byX = [...seats].sort((a, b) => a.entry.x - b.entry.x);
    const leftmost = byX[0];
    const rightmost = byX[byX.length - 1];
    expect(leftmost.yaw).toBeGreaterThan(30 * Math.PI / 180);
    expect(rightmost.yaw).toBeLessThan(30 * Math.PI / 180);
  });

  test('turning the photo turns every dot by the same angle', () => {
    const model = room();
    const spot = { x: 45, y: 75, h: 1.5 };
    const a = projectSeats(model, { heading: 0, tables: ['A'], spot });
    const b = projectSeats(model, { heading: 20, tables: ['A'], spot });
    a.forEach((s, i) => {
      const diff = Math.atan2(Math.sin(b[i].yaw - s.yaw), Math.cos(b[i].yaw - s.yaw));
      expect(deg(diff)).toBeCloseTo(20, 6);
      expect(b[i].pitch).toBeCloseTo(s.pitch, 9);
    });
  });

  test('a standing camera looks down at chairs, and a higher camera looks further down', () => {
    const model = room();
    const view = { heading: 0, tables: ['A'] };
    const low = projectSeats(model, { ...view, spot: { x: 50, y: 75, h: 1.2 } });
    const high = projectSeats(model, { ...view, spot: { x: 50, y: 75, h: 3 } });
    low.forEach((s, i) => {
      expect(s.pitch).toBeLessThan(0);
      expect(high[i].pitch).toBeLessThan(s.pitch);
    });
  });

  test('only the linked rows are offered to a buyer; the studio can see them all', () => {
    const model = room();
    const view = { heading: 0, tables: ['A'], spot: { x: 50, y: 80, h: 1.5 } };
    const buyer = projectSeats(model, view);
    expect(buyer).toHaveLength(10);
    expect(buyer.every((s) => s.entry.tableLabel === 'A')).toBe(true);
    expect(projectSeats(model, view, { onlyLinked: false })).toHaveLength(20);
  });

  test('a photo with no spot has no dots: nothing is guessed for a buyer', () => {
    const model = room();
    expect(projectSeats(model, { heading: 0, tables: ['A'], spot: null })).toEqual([]);
  });

  test('the seat the camera stands on gets no dot', () => {
    const model = room();
    const seat = model.seats.find((s) => s.tableLabel === 'A');
    const spot = { ...sceneToSpot(model, seat.x, seat.z), h: 1.5 };
    const out = projectSeats(model, { heading: 0, tables: ['A'], spot });
    expect(out.find((s) => s.entry.id === seat.id)).toBeUndefined();
    expect(out).toHaveLength(9);
  });
});

describe('spots', () => {
  test('a map spot survives the round trip to the scene and back', () => {
    const model = room();
    const p = spotToScene(model, { x: 37.5, y: 61.25 });
    const back = sceneToSpot(model, p.x, p.z);
    expect(back.x).toBeCloseTo(37.5, 3);
    expect(back.y).toBeCloseTo(61.25, 3);
  });

  test('the first guess is the middle of the linked rows, at standing height', () => {
    const model = room();
    const g = guessSpot(model, ['A']);
    expect(g.h).toBe(DEFAULT_PHOTO_HEIGHT);
    const rowA = model.seats.filter((s) => s.tableLabel === 'A');
    const p = spotToScene(model, g);
    expect(p.x).toBeCloseTo(rowA.reduce((n, s) => n + s.x, 0) / rowA.length, 3);
    expect(p.z).toBeCloseTo(rowA.reduce((n, s) => n + s.z, 0) / rowA.length, 3);
  });
});
