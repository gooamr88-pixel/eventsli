import { describe, it, expect } from 'vitest';
import { formatEventTime } from '../src/app/lib/eventTime';
import { toSaleMap } from '../src/app/organizer/events/[id]/door/doorMap';

describe('formatEventTime', () => {
  it("prints the instant on the event's clock, with the zone named", () => {
    // 00:00 UTC on 6 Sep is 8 pm on 5 Sep in Toronto.
    const text = formatEventTime('2026-09-06T00:00:00.000Z', 'America/Toronto');
    expect(text).toMatch(/Sep 5, 2026/);
    expect(text).toMatch(/8:00\sPM/);
    expect(text).toMatch(/EDT/);
    expect(formatEventTime('2026-09-06T00:00:00.000Z', 'America/Vancouver')).toMatch(/5:00\sPM PDT/);
  });

  it('can print only the date, or only the time', () => {
    expect(formatEventTime('2026-09-06T00:00:00.000Z', 'America/Toronto', { time: false })).toBe('Sep 5, 2026');
    expect(formatEventTime('2026-09-06T00:00:00.000Z', 'America/Toronto', { date: false })).toMatch(/^8:00\sPM EDT$/);
  });

  it('never throws on a missing value, a bad date or an unknown zone', () => {
    expect(formatEventTime(null, 'America/Toronto')).toBe('—');
    expect(formatEventTime('not a date', 'America/Toronto')).toBe('—');
    expect(formatEventTime('2026-09-06T00:00:00.000Z', 'Not/AZone')).toMatch(/2026/);
  });
});

describe('toSaleMap — the door sells from the organizer map', () => {
  const organizerMap = {
    tables: [
      {
        id: 't1', label: 'VIP', seatCount: 2, priceCents: 50000, isPrivate: true, status: 'available',
        position: { x: 10, y: 10, rotation: 0 }, shape: 'round', categoryId: null,
        seats: [
          { id: 's1', tierId: 'tier', section: 'A', row: '1', number: 1, priceOverrideCents: null, status: 'available' },
          { id: 's2', tierId: 'tier', section: 'A', row: '1', number: 2, priceOverrideCents: 9000, status: 'sold' },
        ],
      },
    ],
    looseSeats: [{ id: 's3', tierId: null, section: 'B', row: '2', number: 5, priceOverrideCents: 1500, status: 'available' }],
  };
  const tiers = [{ id: 'tier', priceCents: 7500 }];

  it('keeps private tables — the public map hid them, so they could not be sold at the door', () => {
    const map = toSaleMap(organizerMap, tiers, 'seat_and_table');
    expect(map.tables.map((t) => t.id)).toEqual(['t1']);
    expect(map.tables[0].canBookWhole).toBe(true);
  });

  it('prices each seat the way the buyer map does and flattens availability', () => {
    const { seats } = toSaleMap(organizerMap, tiers, 'seat_only');
    expect(seats).toEqual([
      expect.objectContaining({ id: 's1', tableId: 't1', priceCents: 7500, available: true }),
      expect.objectContaining({ id: 's2', tableId: 't1', priceCents: 9000, available: false }),
      expect.objectContaining({ id: 's3', tableId: null, priceCents: 1500, available: true }),
    ]);
  });

  it('knows an empty map from a missing one, and never offers a whole table in seat-only mode', () => {
    expect(toSaleMap({ tables: [], looseSeats: [] }, [], 'seat_only').hasMap).toBe(false);
    expect(toSaleMap(organizerMap, tiers, 'seat_only').tables[0].canBookWhole).toBe(false);
  });
});
