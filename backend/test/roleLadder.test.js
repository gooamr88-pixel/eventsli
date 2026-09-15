const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mayActOn, ROLE_LEVEL } = require('../utils/roleLadder');

/**
 * The role ladder (BRD §19). The one exception — a super admin acting on
 * another super admin — is what makes the last-super-admin guard reachable.
 */
const person = (id, role) => ({ id, role });

test('nobody acts on themselves, whatever their role', () => {
  assert.equal(mayActOn(person('a', 'super_admin'), person('a', 'super_admin')).error, 'SELF_ACTION');
  assert.equal(mayActOn(person('a', 'admin'), person('a', 'admin')).error, 'SELF_ACTION');
});

test('nobody acts on a superior', () => {
  assert.equal(mayActOn(person('a', 'admin'), person('b', 'super_admin')).error, 'FORBIDDEN');
  assert.equal(mayActOn(person('a', 'organizer'), person('b', 'admin')).error, 'FORBIDDEN');
});

test('an admin cannot act on another admin', () => {
  // Otherwise one compromised admin disables every other and is the last left.
  assert.equal(mayActOn(person('a', 'admin'), person('b', 'admin')).error, 'FORBIDDEN');
});

test('a super admin can act on another super admin, and on anyone below', () => {
  assert.equal(mayActOn(person('a', 'super_admin'), person('b', 'super_admin')), null);
  assert.equal(mayActOn(person('a', 'super_admin'), person('b', 'admin')), null);
  assert.equal(mayActOn(person('a', 'admin'), person('b', 'organizer')), null);
});

test('the ladder has four rungs in this order', () => {
  assert.deepEqual(Object.entries(ROLE_LEVEL).sort((x, y) => x[1] - y[1]).map(([r]) => r),
    ['attendee', 'organizer', 'admin', 'super_admin']);
});
