const { test } = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');

// No database: the Supabase client is replaced before the service loads.
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase: {} } };
const door = require('../services/doorService');

test('a short name is enough to recognise a guest, not a guest list', () => {
  assert.equal(door.shortName('Sara Ahmed'), 'Sara A.');
  assert.equal(door.shortName('  john   ronald  tolkien '), 'john T.');
  assert.equal(door.shortName('Cher'), 'Cher');
  assert.equal(door.shortName(''), null);
  assert.equal(door.shortName(null), null);
});

test('the door team sees the guest list only when the organizer shares it', () => {
  const defaults = { ...door.SETTINGS_DEFAULTS };
  for (const role of ['staff', 'pin']) {
    const p = door.permissionsFor({ role }, defaults);
    assert.equal(p.viewGuests, false, role);
    assert.equal(p.manualCheckIn, false, role);
    assert.equal(p.fullNames, false, role);
    const shared = door.permissionsFor({ role }, { ...defaults, doorTeamCanViewGuests: true });
    assert.equal(shared.viewGuests, true, role);
  }
  const owner = door.permissionsFor({ role: 'owner' }, defaults);
  assert.equal(owner.viewGuests, true);
  assert.equal(owner.fullNames, true);
});

test('names travel to a device offline only when allowed, and never with offline off', () => {
  const d = { ...door.SETTINGS_DEFAULTS };
  assert.equal(door.permissionsFor({ role: 'staff' }, d).offlineNames, false);
  assert.equal(door.permissionsFor({ role: 'staff' }, { ...d, offlineShowNames: true }).offlineNames, true);
  assert.equal(door.permissionsFor({ role: 'owner' }, d).offlineNames, true);
  assert.equal(door.permissionsFor({ role: 'owner' }, { ...d, offlineAdmission: false }).offlineNames, false);
});

test('a search box is not a LIKE pattern', () => {
  assert.equal(door.safeQuery('100%_off\\'), '100 off');
  assert.equal(door.safeQuery('  sara  '), 'sara');
  assert.equal(door.safeQuery('x'.repeat(300)).length, 100);
  assert.equal(door.safeQuery(undefined), '');
});
