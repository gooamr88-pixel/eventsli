const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The homepage's VIP slider (vipEventsService).
 *
 * What must hold: an admin's list is saved whole and in order; nothing that a
 * buyer could not open (a draft, a finished event, a deleted one) can be put
 * on it; and the public read only ever badges an event as VIP when an admin
 * chose it. The database is replaced before the service loads (node --test
 * runs each file in its own process).
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const db = { events: [], rpc: [] };

/** A tiny chainable stand-in for the supabase-js query builder. */
function query(table) {
  let rows = table === 'events' ? [...db.events] : [];
  const q = {
    select() { return q; },
    eq(col, v) { rows = rows.filter((r) => r[col] === v); return q; },
    gte(col, v) { rows = rows.filter((r) => r[col] >= v); return q; },
    in(col, list) { rows = rows.filter((r) => list.includes(r[col])); return q; },
    not(col, op, v) { rows = rows.filter((r) => !(op === 'is' && v === null && (r[col] === null || r[col] === undefined))); return q; },
    order(col, { ascending = true } = {}) {
      rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1));
      return q;
    },
    limit(n) { rows = rows.slice(0, n); return q; },
    then(resolve) { return resolve({ data: rows, error: null }); },
  };
  return q;
}

stub('config/supabase.js', {
  supabase: {
    from: query,
    rpc: async (name, args) => { db.rpc.push({ name, args }); return { error: null }; },
  },
});
stub('controllers/discoveryController.js', {
  SELECT: '*',
  shape: (e) => ({ id: e.id, slug: e.slug, title: e.title }),
  // Rows or ids, as the real one takes (rows let it skip coming-soon teasers).
  lowestTierPrices: async (events) => new Map(events.map((e) => [typeof e === 'string' ? e : e.id, 2500])),
});

const vip = require('../services/vipEventsService');

const NOW = new Date('2026-12-01T00:00:00Z');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (n, over = {}) => ({
  id: id(n), slug: `e${n}`, title: `Event ${n}`, status: 'published',
  starts_at: `2026-12-${String(10 + n).padStart(2, '0')}T20:00:00Z`,
  ends_at: `2026-12-${String(10 + n).padStart(2, '0')}T23:00:00Z`,
  cover_url: `https://cdn.test/${n}.jpg`, vip_rank: null, ...over,
});

test('a save sends the list to the database whole, in order, without duplicates', async () => {
  db.events = [ev(1), ev(2), ev(3)];
  db.rpc = [];
  await vip.save([id(3), id(1), id(3)], { now: NOW });
  assert.deepEqual(db.rpc, [{ name: 'set_vip_events', args: { p_event_ids: [id(3), id(1)] } }]);
});

test('an empty list is a valid save: it clears the slider', async () => {
  db.rpc = [];
  await vip.save([], { now: NOW });
  assert.deepEqual(db.rpc[0].args, { p_event_ids: [] });
});

test('more than twelve, a non-id, a draft, a finished or a missing event is refused by name', async () => {
  db.events = [ev(1), ev(2, { status: 'draft' }), ev(3, { ends_at: '2026-11-01T00:00:00Z' })];
  db.rpc = [];
  await assert.rejects(vip.save(Array.from({ length: 13 }, (_, i) => id(i + 1)), { now: NOW }), /at most 12/);
  await assert.rejects(vip.save(['not-an-id'], { now: NOW }), /not an event/);
  await assert.rejects(vip.save([id(1), id(2)], { now: NOW }), /"Event 2" is not published/);
  await assert.rejects(vip.save([id(3)], { now: NOW }), /"Event 3" is already over/);
  await assert.rejects(vip.save([id(9)], { now: NOW }), (err) => err.code === 'NOT_FOUND');
  assert.equal(db.rpc.length, 0, 'nothing is written when any event is refused');
});

test('the public read returns the ranked, live events in rank order, badged VIP', async () => {
  db.events = [
    ev(1, { vip_rank: 2 }), ev(2, { vip_rank: 1 }),
    ev(3, { vip_rank: 3, status: 'draft' }),                        // ranked but not published
    ev(4, { vip_rank: 4, ends_at: '2026-11-01T00:00:00Z' }),        // ranked but over
    ev(5),                                                            // not ranked
  ];
  const { events, chosen } = await vip.listPublic({ now: NOW });
  assert.equal(chosen, true);
  assert.deepEqual(events.map((e) => e.id), [id(2), id(1)]);
  assert.ok(events.every((e) => e.vip === true && e.fromPriceCents === 2500));
});

test('with nothing ranked, the soonest events with a cover fill in, NOT badged VIP', async () => {
  db.events = [ev(3), ev(1), ev(2, { cover_url: null })];
  const { events, chosen } = await vip.listPublic({ now: NOW });
  assert.equal(chosen, false);
  assert.deepEqual(events.map((e) => e.id), [id(1), id(3)]);
  assert.ok(events.every((e) => e.vip === false));
});

test('the console is told why a ranked event is not on the homepage', () => {
  assert.equal(vip.adminRow(ev(1), NOW).hidden, null);
  assert.equal(vip.adminRow(ev(1, { status: 'cancelled' }), NOW).hidden, 'Not published');
  assert.equal(vip.adminRow(ev(1, { ends_at: '2026-11-01T00:00:00Z' }), NOW).hidden, 'Event has ended');
});
