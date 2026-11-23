const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The organizer's Orders list shows each order's add-ons (2026-11-23).
 *
 * The owner reported the Orders section did not show them at all — the order
 * list never read add-ons. `addonService.forOrders` groups them per order:
 * from the tickets for a paid order (one `ticket_addons` row per ticket), and
 * from the hold for an order that never got tickets.
 *
 * No database: the Supabase client is replaced with a stub that answers the
 * two reads from fixed rows. The real tables are covered by
 * integration/addons.test.js.
 */
const tables = {
  ticket_addons: [
    { order_id: 'paid', addon_id: 'photo', unit_price_cents: 2000, event_addons: { name: 'Photo with the star', sort_order: 1 } },
    { order_id: 'paid', addon_id: 'photo', unit_price_cents: 2000, event_addons: { name: 'Photo with the star', sort_order: 1 } },
    { order_id: 'paid', addon_id: 'poster', unit_price_cents: 1500, event_addons: [{ name: 'Signed poster', sort_order: 0 }] },
  ],
  reservation_addons: [
    { reservation_id: 'hold-unfinished', addon_id: 'photo', quantity: 2, unit_price_cents: 2000, event_addons: { name: 'Photo with the star', sort_order: 1 } },
    // The paid order's hold — never read, because its tickets already answer.
    { reservation_id: 'hold-paid', addon_id: 'poster', quantity: 9, unit_price_cents: 1500, event_addons: { name: 'Signed poster', sort_order: 0 } },
  ],
};
const reads = [];
const supabase = {
  from(table) {
    return {
      select() { return this; },
      in(column, values) {
        reads.push({ table, column, values });
        return Promise.resolve({ data: tables[table].filter((r) => values.includes(r[column])), error: null });
      },
    };
  },
};
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase } };
const { forOrders } = require('../services/addonService');

test('a paid order counts its add-ons from its tickets, sorted as the organizer ordered them', async () => {
  reads.length = 0;
  const map = await forOrders([{ id: 'paid', reservation_id: 'hold-paid' }]);
  assert.deepEqual(map.get('paid'), [
    { addonId: 'poster', name: 'Signed poster', quantity: 1, unitPriceCents: 1500, amountCents: 1500 },
    { addonId: 'photo', name: 'Photo with the star', quantity: 2, unitPriceCents: 2000, amountCents: 4000 },
  ]);
  assert.equal(reads.some((r) => r.table === 'reservation_addons'), false, 'the hold is not read when tickets answer');
});

test('an order with no tickets shows what its hold chose; one with neither shows nothing', async () => {
  const map = await forOrders([
    { id: 'paid', reservation_id: 'hold-paid' },
    { id: 'unfinished', reservation_id: 'hold-unfinished' },
    { id: 'door-sale', reservation_id: null },
  ]);
  assert.deepEqual(map.get('unfinished'), [
    { addonId: 'photo', name: 'Photo with the star', quantity: 2, unitPriceCents: 2000, amountCents: 4000 },
  ]);
  assert.equal(map.has('door-sale'), false);
  assert.equal(map.get('paid').length, 2);
});

test('no orders, no reads', async () => {
  reads.length = 0;
  assert.equal((await forOrders([])).size, 0);
  assert.equal(reads.length, 0);
});
