import { describe, test, expect } from 'vitest';
import {
  SHAPES, SEAT_RADIUS, tableBody, seatPositions, sideCounts,
} from '../src/app/components/seating/seatingGeometry';
import { SHAPE_SIDES } from '../src/app/components/seating/tableSides';
import {
  cleanTableStyle, withTableStyles, writeTableStyles, readLook, writeLook, cleanLook,
  LOOK_PRESETS, cleanZoneStyle, isStyledZone, tablePaint,
} from '../src/app/components/seating/mapStyle';
import { readZones, writeZones } from '../src/app/components/seating/layoutZones';
import { paintOrder, minZoneSize } from '../src/app/components/seating/venueZones';

const noOverlap = (seats, label) => {
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      const d = Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y);
      expect(d, `${label}: seats ${i + 1} and ${j + 1}`).toBeGreaterThanOrEqual(SEAT_RADIUS * 2 - 0.01);
    }
  }
};

describe('seats per side', () => {
  test('the organizer’s counts are used when they add up, on every sided shape', () => {
    for (const [shape, allowed] of Object.entries(SHAPE_SIDES)) {
      for (const combo of [[2, 1, 2, 1], [0, 3, 0, 3], [5, 0, 5, 0], [1, 1, 1, 1], [8, 2, 0, 2]]) {
        const sides = {};
        ['top', 'right', 'bottom', 'left'].forEach((k, i) => { if (allowed.includes(i)) sides[k] = combo[i]; });
        const n = Object.values(sides).reduce((a, b) => a + b, 0);
        if (n < 1) continue;
        const style = { sides };
        const counts = sideCounts(shape, n, style);
        expect(counts.reduce((a, b) => a + b, 0), shape).toBe(n);
        const seats = seatPositions(shape, n, style);
        expect(seats, `${shape} ${combo}`).toHaveLength(n);
        noOverlap(seats, `${shape} ${combo}`);
      }
    }
  });

  test('counts that do not add up fall back to the shape’s own spread', () => {
    const style = { sides: { top: 4, bottom: 4 } };
    expect(sideCounts('rect', 6, style)).toEqual(sideCounts('rect', 6, null));
    // A side the shape does not have is ignored.
    expect(sideCounts('u_shape', 3, { sides: { bottom: 3 } })).toEqual(sideCounts('u_shape', 3, null));
  });

  test('an unstyled rect and square are drawn exactly as before', () => {
    expect(tableBody('rect', 8)).toEqual({ kind: 'rect', width: 8 / 2 * 24 + 12, height: 52, rx: 6 });
    expect(tableBody('square', 8).rx).toBe(6);
    expect(tableBody('rect', 8, { radius: 0 }).rx).toBe(0);
  });

  test('a D-shape with seats only on its flat back has none on the curve', () => {
    const seats = seatPositions('d_shape', 3, { sides: { left: 3, right: 0 } });
    const body = tableBody('d_shape', 3, { sides: { left: 3, right: 0 } });
    for (const s of seats) expect(s.x).toBeLessThan(-body.width / 2);
  });

  test('every shape at every count keeps its seats apart', () => {
    for (const shape of SHAPES) {
      for (const n of [1, 2, 3, 5, 7, 10, 16, 30, 60]) noOverlap(seatPositions(shape, n), `${shape} × ${n}`);
    }
  });
});

describe('table styles in the layout', () => {
  test('round trip by label, case-insensitively', () => {
    const tables = [
      { label: 'S01', style: { fill: '#8C8C8C', sides: { top: 2, bottom: 2 }, junk: 1 } },
      { label: 'S02', style: null },
    ];
    const layout = writeTableStyles({ zones: [] }, tables);
    expect(layout.tableStyles).toEqual({ s01: { fill: '#8c8c8c', sides: { top: 2, bottom: 2 } } });
    expect(layout.zones).toEqual([]);
    const read = withTableStyles([{ label: 's01' }, { label: 'S02' }], layout);
    expect(read[0].style.fill).toBe('#8c8c8c');
    expect(read[1].style).toBeUndefined();
  });

  test('a table already carrying a style keeps it (the editor’s draft is newer)', () => {
    const layout = { tableStyles: { t1: { fill: '#000000' } } };
    expect(withTableStyles([{ label: 'T1', style: null }], layout)[0].style).toBeNull();
  });

  test('anything that is not a colour or a number in range is dropped', () => {
    expect(cleanTableStyle({ fill: 'red', strokeWidth: 99, radius: -3, seatColor: '#abc' }))
      .toEqual({ strokeWidth: 8, radius: 0, seatColor: '#aabbcc' });
    expect(cleanTableStyle({})).toBeNull();
  });

  test('the table’s own colour beats the category, which beats the look', () => {
    const look = { table: '#111111', label: '#222222' };
    expect(tablePaint({ style: { fill: '#333333' } }, look, { fill: '#444444' }).fill).toBe('#333333');
    expect(tablePaint({}, look, { fill: '#444444' }).fill).toBe('#444444');
    expect(tablePaint({}, look).fill).toBe('#111111');
    expect(tablePaint({}, null).fill).toBeNull();
  });
});

describe('the map look', () => {
  test('presets are clean looks', () => {
    for (const p of LOOK_PRESETS) expect(cleanLook(p)).toMatchObject({ floor: p.floor, seat: p.seat, accent: p.accent });
  });

  test('written and read back; an empty look removes the key', () => {
    const layout = writeLook({ world: { width: 1000, height: 700 } }, { floor: '#FFFCF2', font: 'bold', x: 1 });
    expect(readLook(layout)).toEqual({ floor: '#fffcf2', font: 'bold' });
    expect('look' in writeLook(layout, null)).toBe(false);
  });
});

describe('zone styles and the room', () => {
  test('style keys survive a save and a load', () => {
    const zone = {
      id: 'z1', kind: 'bar', x: 10, y: 10, w: 80, h: 60, rotation: 0,
      shape: 'pill', fill: '#C3E4DF', fillOpacity: 0.8, strokeStyle: 'none', sublabel: 'Tea and coffee · Drinks',
      textSize: 'l', showIcon: false, textColor: '#10303d', bogus: 'x',
    };
    const [back] = readZones(writeZones({}, [zone]));
    expect(back).toMatchObject({
      shape: 'pill', fill: '#c3e4df', fillOpacity: 0.8, strokeStyle: 'none', sublabel: 'Tea and coffee · Drinks', textSize: 'l', showIcon: false,
    });
    expect(back.bogus).toBeUndefined();
    expect(isStyledZone(back)).toBe(true);
    expect(isStyledZone({ kind: 'bar' })).toBe(false);
    expect(cleanZoneStyle({ shape: 'star', strokeStyle: 'wavy' })).toEqual({});
  });

  test('a wall may be a few units thick, and is painted under everything', () => {
    const [wall] = readZones(writeZones({}, [{ id: 'w', kind: 'wall', x: 50, y: 5, w: 300, h: 4 }]));
    expect(wall.h).toBe(4);
    expect(minZoneSize('wall').h).toBeLessThan(minZoneSize('bar').h);
    const order = paintOrder([{ id: 'd', kind: 'door_gap' }, { id: 'w', kind: 'wall' }]).map((z) => z.id);
    expect(order).toEqual(['w', 'd']);
  });
});
