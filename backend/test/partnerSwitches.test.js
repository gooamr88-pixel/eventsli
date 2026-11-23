const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Sponsors / vendors are opt-in per event (2026-11-23). The switch is the
 * program row each system already has; an event with a deal or application
 * counts as on regardless, and cannot be switched off.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let tables = {};
const calls = [];

function builder(table) {
  const q = {
    table,
    select(_cols, opts) { q.head = opts?.head; return q; },
    in(_col, ids) { q.ids = ids; return q; },
    eq(_col, id) { q.id = id; return q; },
    upsert(row, opts) { calls.push(['upsert', table, row, opts]); return q; },
    delete() { calls.push(['delete', table]); q.deleting = true; return q; },
    then(resolve) {
      const rows = tables[table] || [];
      if (q.deleting) return resolve({ error: null });
      if (q.head) return resolve({ count: rows.filter((r) => r.event_id === q.id).length, error: null });
      if (q.ids) return resolve({ data: rows.filter((r) => q.ids.includes(r.event_id)), error: null });
      return resolve({ error: null });
    },
  };
  return q;
}

stub('config/supabase.js', { supabase: { from: (t) => builder(t) } });
const S = require('../services/partnerSwitches');

test('on means a program row, or work already started', async () => {
  tables = {
    sponsorship_programs: [{ event_id: 'a' }],
    sponsorship_deals: [{ event_id: 'b' }],
    event_sponsors: [{ event_id: 'd' }],
    vendor_programs: [],
    vendor_applications: [{ event_id: 'a' }],
  };
  const on = await S.partnersOn(['a', 'b', 'c', 'd']);
  assert.deepEqual(on.get('a'), { sponsors: true, vendors: true });
  assert.deepEqual(on.get('b'), { sponsors: true, vendors: false });
  assert.deepEqual(on.get('c'), { sponsors: false, vendors: false });
  // Logos added by hand to the event page count: they are managed on Sponsors now.
  assert.deepEqual(on.get('d'), { sponsors: true, vendors: false });
});

test('no events asks nothing', async () => {
  calls.length = 0;
  assert.equal((await S.partnersOn([])).size, 0);
});

test('turning on creates the program row closed, and is safe twice', async () => {
  calls.length = 0;
  await S.turnOn('vendors', 'e1');
  const [kind, table, row, opts] = calls[0];
  assert.equal(kind, 'upsert');
  assert.equal(table, 'vendor_programs');
  assert.deepEqual(row, { event_id: 'e1' });
  assert.equal(opts.ignoreDuplicates, true);
});

test('turning off is refused once a deal exists, and says why', async () => {
  tables = { sponsorship_deals: [{ event_id: 'e1' }, { event_id: 'e1' }] };
  calls.length = 0;
  await assert.rejects(S.turnOff('sponsors', 'e1'), (err) => {
    assert.equal(err.code, 'CONFLICT');
    assert.match(err.message, /2 sponsorship deals/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('turning off with nothing started removes only the program row', async () => {
  tables = { vendor_applications: [] };
  calls.length = 0;
  await S.turnOff('vendors', 'e1');
  assert.deepEqual(calls, [['delete', 'vendor_programs']]);
});

test('sponsors stay on while the event page shows a hand-added sponsor', async () => {
  tables = { sponsorship_deals: [], event_sponsors: [{ event_id: 'e1' }] };
  calls.length = 0;
  await assert.rejects(S.turnOff('sponsors', 'e1'), (err) => err.code === 'CONFLICT' && /shows a sponsor/.test(err.message));
  assert.equal(calls.length, 0);
});

test('an unknown kind is refused', async () => {
  await assert.rejects(S.turnOn('caterers', 'e1'), (err) => err.code === 'VALIDATION_ERROR');
});
