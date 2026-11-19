const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Unit test, no database: stub what the services import that needs credentials.
for (const [name, exports] of [
  ['mediaService', { publicUrl: (p) => `https://storage.test/${p}` }],
  ['../config/supabase', { supabase: {} }],
]) {
  const file = require.resolve(path.join(__dirname, '..', name.startsWith('..') ? name.slice(3) : `services/${name}`));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const { sanitizeLayout, publicLayout } = require('../services/venueStudio');
const { cleanList, MAX_LOOKS } = require('../services/mapLookService');

/**
 * Seating-map styling (2026-11-18): table styles keyed by label and the map's
 * look ride in the layout blob, which buyers read. Only colours, numbers in
 * range and known words may be stored, and a hidden table's style (keyed by
 * its name) must never reach a buyer.
 */
test('table styles and the look are cleaned on save', () => {
  const out = sanitizeLayout('e1', {
    zones: [],
    look: { floor: '#FFFCF2', wall: 'url(javascript:x)', font: 'comic', name: '  Gala  ' },
    tableStyles: {
      S01: { fill: '#8C8C8C', sides: { top: 2, left: 99, middle: 3 }, strokeWidth: 50, onclick: 'x' },
      S02: { fill: 'red' },
    },
  });
  assert.deepEqual(out.look, { floor: '#fffcf2', name: 'Gala' });
  assert.deepEqual(out.tableStyles, { s01: { fill: '#8c8c8c', sides: { top: 2, left: 60 }, strokeWidth: 8 } });
  assert.deepEqual(out.zones, []);
});

test('a look or styles with nothing usable are removed, not stored empty', () => {
  const out = sanitizeLayout('e1', { look: { floor: 'blue' }, tableStyles: { T1: { fill: 'no' } } });
  assert.equal('look' in out, false);
  assert.equal('tableStyles' in out, false);
});

test('buyers receive only the visible tables’ styles', () => {
  const layout = { zones: [1], tableStyles: { t1: { fill: '#000000' }, 'vip lounge': { fill: '#111111' } } };
  assert.deepEqual(publicLayout(layout, ['T1']).tableStyles, { t1: { fill: '#000000' } });
  assert.deepEqual(publicLayout(layout, ['T1']).zones, [1]);
  assert.equal('tableStyles' in publicLayout(layout, []), false);
  assert.equal(publicLayout(null, ['T1']), null);
});

test('saved looks are cleaned, named, de-duplicated and capped', () => {
  const list = cleanList([
    { id: 'look_a1b2', name: 'Mine', floor: '#FFFFFF', seat: '#ff414b' },
    { id: 'look_a1b2', name: 'Copy', floor: '#000000' },
    { name: '', floor: 'nope' },
    { floor: '#123456' },
    ...Array.from({ length: 20 }, () => ({ table: '#abcdef' })),
  ]);
  assert.equal(list.length, MAX_LOOKS);
  assert.deepEqual(list[0], { floor: '#ffffff', seat: '#ff414b', name: 'Mine', id: 'look_a1b2' });
  assert.equal(list[1].name, 'My look');
  assert.match(list[1].id, /^look_/);
});

test('a table size is kept in range and 100% is not stored (2026-11-19)', () => {
  const out = sanitizeLayout('e1', {
    tableStyles: { A: { scale: 0.6 }, B: { scale: 0.01 }, C: { scale: 1 }, D: { scale: 'huge' } },
  });
  assert.deepEqual(out.tableStyles, { a: { scale: 0.6 }, b: { scale: 0.5 } });
});
