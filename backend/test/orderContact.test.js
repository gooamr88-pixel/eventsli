const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * An organizer correcting a buyer's contact on one order (2026-11-23,
 * services/orderContactService.js). The database is a small in-memory fake,
 * installed before the service loads (node --test runs each file alone).
 *
 * What must hold:
 *   · the order's own fields change, never the buyer's account;
 *   · the buyer's own tickets follow; a separately named holder and a
 *     transferred ticket do not;
 *   · an order with an email cannot lose it; an order on another event is a 404.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let db;
const writes = [];

function query(table) {
  const filters = [];
  let op = 'select';
  let patch = null;
  const rows = () => db[table].filter((r) => filters.every(([k, v]) => r[k] === v));
  const run = () => {
    if (op === 'update') {
      const hit = rows();
      hit.forEach((r) => Object.assign(r, patch));
      writes.push({ table, patch, ids: hit.map((r) => r.id) });
      return { error: null };
    }
    return { data: rows(), error: null };
  };
  const q = {
    select() { return q; },
    update(p) { op = 'update'; patch = p; return q; },
    eq(k, v) { filters.push([k, v]); return q; },
    maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
  };
  return q;
}

stub('config/supabase.js', { supabase: { from: query } });

const { updateContact, effectiveContact } = require('../services/orderContactService');

beforeEach(() => {
  writes.length = 0;
  db = {
    orders: [
      {
        id: 'o1', event_id: 'e1', status: 'paid', user_id: null,
        guest_name: 'Sara Ahmd', guest_email: 'sara@gmial.com', guest_phone: null, profiles: null,
      },
      {
        id: 'o2', event_id: 'e1', status: 'paid', user_id: 'u1',
        guest_name: null, guest_email: null, guest_phone: null, profiles: { full_name: 'Omar Account', email: 'omar@acct.com' },
      },
      {
        id: 'o3', event_id: 'e1', status: 'paid', user_id: null,
        guest_name: 'Free Name', guest_email: null, guest_phone: null, profiles: null,
      },
    ],
    tickets: [
      // Stamped with the buyer (a door sale): follows the buyer.
      { id: 't1', order_id: 'o1', attendee_name: 'sara ahmd', attendee_email: 'SARA@gmial.com', transfer_count: 0 },
      // No name of its own: reads the order's, nothing to change.
      { id: 't2', order_id: 'o1', attendee_name: null, attendee_email: null, transfer_count: 0 },
      // A friend named separately: never touched.
      { id: 't3', order_id: 'o1', attendee_name: 'Lina Friend', attendee_email: 'lina@example.com', transfer_count: 0 },
      // Transferred away: never touched, even though it still says the buyer.
      { id: 't4', order_id: 'o1', attendee_name: 'Sara Ahmd', attendee_email: 'sara@gmial.com', transfer_count: 1 },
    ],
  };
});

test('corrects the order and keeps only the buyer\'s own tickets in step', async () => {
  const out = await updateContact('e1', 'o1', { name: '  Sara   Ahmed ', email: 'Sara@Gmail.com', phone: '+1 416 555 0100' });
  assert.deepEqual(out.changed, { name: true, email: true, phone: true });
  assert.deepEqual(out.before, { name: 'Sara Ahmd', email: 'sara@gmial.com', phone: null });
  assert.deepEqual(out.after, { name: 'Sara Ahmed', email: 'sara@gmail.com', phone: '+1 416 555 0100' });

  const o1 = db.orders.find((o) => o.id === 'o1');
  assert.equal(o1.guest_name, 'Sara Ahmed');
  assert.equal(o1.guest_email, 'sara@gmail.com');
  assert.equal(o1.guest_phone, '+1 416 555 0100');

  assert.equal(out.ticketsUpdated, 1);
  const t = Object.fromEntries(db.tickets.map((x) => [x.id, x]));
  assert.equal(t.t1.attendee_name, 'Sara Ahmed');
  assert.equal(t.t1.attendee_email, 'sara@gmail.com');
  assert.equal(t.t2.attendee_name, null);
  assert.equal(t.t3.attendee_name, 'Lina Friend');
  assert.equal(t.t4.attendee_name, 'Sara Ahmd');
});

test('an account buyer: the order gets its own contact, the account is not written', async () => {
  const out = await updateContact('e1', 'o2', { name: 'Omar Haddad', email: 'omar@acct.com', phone: null });
  assert.deepEqual(out.changed, { name: true, email: false, phone: false });
  const o2 = db.orders.find((o) => o.id === 'o2');
  assert.equal(o2.guest_name, 'Omar Haddad');
  assert.equal(o2.guest_email, 'omar@acct.com');
  assert.deepEqual(o2.profiles, { full_name: 'Omar Account', email: 'omar@acct.com' });
  assert.ok(writes.every((w) => w.table !== 'profiles'));
});

test('no change writes nothing', async () => {
  const out = await updateContact('e1', 'o1', { name: 'Sara Ahmd', email: 'SARA@gmial.com', phone: '' });
  assert.deepEqual(out.changed, { name: false, email: false, phone: false });
  assert.equal(writes.length, 0);
});

test('an order with an email cannot lose it; one that never had one may stay without', async () => {
  await assert.rejects(updateContact('e1', 'o1', { name: 'Sara', email: '' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(updateContact('e1', 'o2', { name: 'Omar', email: null }), { code: 'VALIDATION_ERROR' });
  const out = await updateContact('e1', 'o3', { name: 'Free Name Corrected', email: '' });
  assert.equal(out.changed.name, true);
  assert.equal(db.orders.find((o) => o.id === 'o3').guest_email, null);
});

test('a name is required, and an order on another event is not found', async () => {
  await assert.rejects(updateContact('e1', 'o1', { name: '   ', email: 'a@b.co' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(updateContact('e2', 'o1', { name: 'X', email: 'a@b.co' }), { code: 'NOT_FOUND' });
});

test('the effective contact puts the order before the account', () => {
  assert.deepEqual(
    effectiveContact({ guest_name: 'Order Name', guest_email: null, guest_phone: ' ', profiles: { full_name: 'Acct', email: 'a@acct.com' } }),
    { name: 'Order Name', email: 'a@acct.com', phone: null },
  );
});
