import type { SeatMap } from '../src/api/types';
import { buildModel, clampView, fitView, hitTest, keepView, OPEN_SEAT } from '../src/seating/model';

/**
 * The seat map model is built from the WEBSITE'S geometry modules (imported
 * through @shared, never copied). These tests fail if that import breaks, or
 * if the app's reading of the payload drifts from where the website draws.
 */

const tier = (id: string, priceCents: number) => ({
  id, name: id.toUpperCase(), priceCents, onSale: true, soldOut: false, maxPerOrder: null, description: null, kind: 'standard',
});

function payload(): SeatMap {
  return {
    event: { id: 'e', slug: 's', title: 'T', currency: 'EGP', purchaseMode: 'seat_and_table', admissionType: 'reserved', maxTicketsPerOrder: 10, startsAt: '2026-12-01T18:00:00Z', endsAt: null },
    map: {
      id: 'm', version: 1,
      layout: {
        zones: [{ id: 'z1', kind: 'stage', x: 50, y: 10, w: 200, h: 60 }, { id: 'z2', kind: 'not_a_kind', x: 1, y: 1 }],
      },
    },
    tiers: [tier('vip', 320000), tier('reg', 90000)],
    tables: [
      { id: 't1', label: 'T1', seatCount: 4, priceCents: 1000000, status: 'available', canBookWhole: true, isPrivate: false, position: { x: 30, y: 50, rotation: 0 }, shape: 'round' },
      { id: 'r1', label: 'A', seatCount: 3, priceCents: null, status: 'available', canBookWhole: false, isPrivate: false, position: { x: 70, y: 50, rotation: 90 }, shape: 'row' },
    ],
    seats: [
      // Out of order on purpose: seat 1 must still be the geometry's first.
      { id: 's2', tableId: 't1', tierId: 'vip', section: null, row: null, number: '2', priceCents: 320000, available: true },
      { id: 's1', tableId: 't1', tierId: 'vip', section: null, row: null, number: '1', priceCents: 320000, available: false, reason: 'taken' },
      { id: 'a1', tableId: 'r1', tierId: 'reg', section: 'Orchestra', row: 'C', number: '1', priceCents: 90000, available: true },
    ],
    hiddenTableCount: 0,
  };
}

test('builds tables, seats and zones from the shared geometry', () => {
  const m = buildModel(payload())!;
  expect(m.world).toEqual({ width: 1000, height: 700 });
  expect(m.zones.map((z) => z.kind)).toEqual(['stage']); // the unknown kind is dropped, not guessed
  expect(m.tables).toHaveLength(2);
  expect(m.seats).toHaveLength(7); // every position drawn, with or without a seat row

  // Seat 1 of a round table is at the top (seatingGeometry: clockwise from 12).
  const first = m.seats.find((p) => p.tableId === 't1')!;
  expect(first.seat?.id).toBe('s1');
  expect(first.x).toBeCloseTo(300, 0);
  expect(first.y).toBeLessThan(350);

  // A row turned 90° runs down the page.
  const row = m.seats.filter((p) => p.tableId === 'r1');
  expect(row[0].x).toBeCloseTo(row[2].x, 3);
  expect(row[2].y).toBeGreaterThan(row[0].y);
});

test('colours by ticket type only when there is more than one, dearest first', () => {
  const m = buildModel(payload())!;
  expect(m.byTier).toBe(true);
  expect(m.palette.get('vip')).not.toBe(m.palette.get('reg'));

  const one = payload();
  one.seats = one.seats.map((s) => ({ ...s, tierId: 'vip' }));
  expect(buildModel(one)!.byTier).toBe(false);
  expect(OPEN_SEAT).toMatch(/^#/);
});

test('names a seat the way the ticket does', () => {
  const m = buildModel(payload())!;
  const data = payload();
  expect(m.nameOf(data.seats[0])).toBe('Table T1 · Seat 2');
  expect(m.nameOf(data.seats[2])).toBe('Section Orchestra · Row C · Seat 1');
});

test('a tap finds the nearest seat, else the table under it', () => {
  const m = buildModel(payload())!;
  const s1 = m.seats.find((p) => p.seat?.id === 's1')!;
  const hit = hitTest(m, s1.x + 2, s1.y + 1, 10);
  expect(hit?.kind === 'seat' && hit.placed.seat?.id).toBe('s1');

  const centre = hitTest(m, 300, 350, 4);
  expect(centre?.kind === 'table' && centre.table.table.id).toBe('t1');

  expect(hitTest(m, 950, 650, 10)).toBeNull();
});

test('views open fitted and stay over the content', () => {
  const box = { x: 100, y: 100, width: 400, height: 200 };
  const v = fitView(box, 300, 300);
  expect(v.width).toBeCloseTo(v.height);
  expect(v.width).toBeGreaterThanOrEqual(400);

  const far = clampView({ x: 5000, y: 5000, width: 10, height: 10 }, box, 1);
  expect(far.x + far.width / 2).toBeLessThanOrEqual(box.x + box.width);
  expect(far.width).toBeGreaterThan(10); // not zoomed past a few seats across
});

test('no map, no model', () => {
  expect(buildModel({ ...payload(), map: null })).toBeNull();
});

test('a zoomed-in map keeps its zoom and centre when its box resizes (the map stays still)', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 700 };
  // Zoomed in on a row: 200 world units across a 400-point box.
  const view = { x: 400, y: 300, width: 200, height: 150 };
  // The selection bar grew: the box is now 400 × 220 instead of 400 × 300.
  const kept = keepView(view, 400, 400, 220, bounds);
  expect(kept.width).toBeCloseTo(200); // same world units per point
  expect(kept.x + kept.width / 2).toBeCloseTo(500); // same centre
  expect(kept.y + kept.height / 2).toBeCloseTo(375);
  expect(kept.height / kept.width).toBeCloseTo(220 / 400);
});
