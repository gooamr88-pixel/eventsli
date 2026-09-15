const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planKeep } = require('../utils/resetPlan');

const fk = (table, column, references, notNull = false) => ({ table, column, references, notNull });

test('platform_settings is cascaded through updated_by, and restored with it cleared', () => {
  // The bug: TRUNCATE profiles CASCADE also emptied platform_settings.
  const plan = planKeep({
    wipe: ['profiles', 'events'],
    keep: ['platform_settings', 'terms_versions', 'job_leases'],
    foreignKeys: [
      fk('platform_settings', 'updated_by', 'profiles'),
      fk('events', 'organizer_id', 'profiles', true),
    ],
  });
  assert.deepEqual(plan.cascaded, ['platform_settings']);
  assert.deepEqual(plan.restoreOrder, [{ table: 'platform_settings', nullColumns: ['updated_by'] }]);
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.unresolved, []);
});

test('a kept table with no path to a wiped one is left alone', () => {
  const plan = planKeep({
    wipe: ['profiles'],
    keep: ['terms_versions'],
    foreignKeys: [fk('terms_acceptances', 'terms_id', 'terms_versions', true)],
  });
  assert.deepEqual(plan.cascaded, []);
  assert.deepEqual(plan.restoreOrder, []);
});

test('a NOT NULL reference into a wiped table blocks the reset', () => {
  const plan = planKeep({
    wipe: ['profiles'],
    keep: ['platform_settings'],
    foreignKeys: [fk('platform_settings', 'owner_id', 'profiles', true)],
  });
  assert.deepEqual(plan.blocked, ['platform_settings.owner_id → profiles']);
});

test('cascade is followed through kept tables, and parents are restored first', () => {
  // child → parent → profiles: emptying profiles empties parent, which empties child.
  const plan = planKeep({
    wipe: ['profiles'],
    keep: ['child', 'parent'],
    foreignKeys: [
      fk('child', 'parent_id', 'parent', true),
      fk('parent', 'edited_by', 'profiles'),
    ],
  });
  assert.deepEqual(plan.cascaded.sort(), ['child', 'parent']);
  assert.deepEqual(plan.restoreOrder.map((p) => p.table), ['parent', 'child']);
  assert.deepEqual(plan.restoreOrder.find((p) => p.table === 'child').nullColumns, [],
    'a reference to a kept table that is restored too stays as it was');
  assert.deepEqual(plan.blocked, []);
});

test('a cycle between kept tables is reported, not guessed at', () => {
  const plan = planKeep({
    wipe: ['profiles'],
    keep: ['a', 'b'],
    foreignKeys: [
      fk('a', 'b_id', 'b'),
      fk('b', 'a_id', 'a'),
      fk('a', 'by', 'profiles'),
    ],
  });
  assert.deepEqual(plan.unresolved.sort(), ['a', 'b']);
});
