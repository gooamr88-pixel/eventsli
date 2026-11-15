import { describe, test, expect } from 'vitest';
import { buildModel } from '../src/app/e/[slug]/blocksModel';

/**
 * The event page's "Blocks and prices" (blocksModel.js). What a block says is a
 * promise to a buyer before they open the map: the prices they can still buy,
 * "Sold out" when the seats are taken, "Not available" when there is nothing
 * to sell — and those two must not be swapped.
 */
const tiers = [{ id: 'a', priceCents: 9900 }, { id: 'b', priceCents: 33400 }];
const seat = (id, tableId, tierId, priceCents, extra = {}) => ({ id, tableId, tierId, priceCents, available: true, ...extra });

describe('blocks and prices', () => {
  const data = {
    map: { layout: { sections: [
      { id: 's2', name: 'Block 102', rows: [{ table: 'T2', row: 'A' }] },
      { id: 's1', name: 'Block 101', rows: [{ table: 'T1', row: 'A' }] },
      { id: 's3', name: 'Block 103', rows: [{ table: 'T3', row: 'A' }] },
    ] } },
    tiers,
    tables: [{ id: 't1', label: 'T1' }, { id: 't2', label: 'T2' }, { id: 't3', label: 'T3' }],
    seats: [
      seat('1', 't1', 'b', 33400), seat('2', 't1', 'a', 9900), seat('3', 't1', 'a', 9900, { available: false, reason: 'taken' }),
      seat('4', 't2', 'a', 9900, { available: false, reason: 'taken' }),
      seat('5', 't3', 'a', 9900, { available: false, reason: 'off_sale' }),
    ],
  };
  const model = buildModel(data);

  test('blocks are listed in their natural order', () => {
    expect(model.blocks.map((b) => b.name)).toEqual(['Block 101', 'Block 102', 'Block 103']);
  });

  test('an open block lists each price it can still sell, cheapest first, once each', () => {
    expect(model.blocks[0].prices.map((p) => p.cents)).toEqual([9900, 33400]);
  });

  test('taken seats make a block "sold out"; nothing to sell makes it "not available"', () => {
    expect(model.blocks[1]).toMatchObject({ prices: [], soldOut: true });
    expect(model.blocks[2]).toMatchObject({ prices: [], soldOut: false });
  });

  test('the legend has one chip per ticket type on the map, cheapest first', () => {
    expect(model.legend.map((l) => l.cents)).toEqual([9900, 33400]);
  });

  test('a map drawn without sections falls back to its tables', () => {
    const plain = buildModel({ ...data, map: { layout: {} } });
    expect(plain.blocks.map((b) => b.name)).toEqual(['Table T1', 'Table T2', 'Table T3']);
  });

  test('no map, no model', () => {
    expect(buildModel({ map: null })).toBeNull();
  });
});
