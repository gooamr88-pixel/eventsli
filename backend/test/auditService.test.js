const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The audit trail must SAY when a row did not land.
 *
 * supabase-js returns `{ error }` rather than throwing, and every hand-written
 * insert ignored it — so a refused audit write looked exactly like a written
 * one. The database-touching dependencies are replaced before the service loads
 * (node --test runs each file in its own process).
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let outcome = 'ok';
const inserted = [];
const logged = [];

stub('config/supabase.js', {
  supabase: {
    from: (table) => ({
      insert: async (row) => {
        inserted.push({ table, row });
        if (outcome === 'throw') throw new Error('socket hang up');
        return { error: outcome === 'refuse' ? { message: 'permission denied for table admin_audit' } : null };
      },
    }),
  },
});
stub('utils/logger.js', {
  error: (obj, msg) => logged.push({ obj, msg }), warn() {}, info() {},
});
stub('utils/crypto.js', { hashIp: (ip) => `hashed:${ip}` });

const { writeAudit } = require('../services/auditService');

const req = { user: { id: 'admin-1' }, ip: '203.0.113.9' };
const entry = { action: 'user.blocked', targetType: 'user', targetId: 'user-9', payload: { reason: 'Fraud report' } };

test('a written row reports true and carries the actor, target and a hashed address', async () => {
  outcome = 'ok';
  assert.equal(await writeAudit(req, entry), true);
  const { table, row } = inserted.at(-1);
  assert.equal(table, 'admin_audit');
  assert.deepEqual(row, {
    actor_id: 'admin-1', action: 'user.blocked', target_type: 'user', target_id: 'user-9',
    payload: { reason: 'Fraud report' }, ip_hash: 'hashed:203.0.113.9',
  });
});

test('a refused insert is reported and logged with the whole row', async () => {
  outcome = 'refuse';
  logged.length = 0;
  assert.equal(await writeAudit(req, entry), false);
  assert.equal(logged.length, 1);
  assert.match(logged[0].msg, /AUDIT WRITE FAILED/);
  assert.equal(logged[0].obj.audit.target_id, 'user-9', 'enough to write the row by hand');
});

test('a thrown insert is reported the same way, never rethrown', async () => {
  outcome = 'throw';
  logged.length = 0;
  assert.equal(await writeAudit(req, entry), false);
  assert.equal(logged.length, 1);
});
