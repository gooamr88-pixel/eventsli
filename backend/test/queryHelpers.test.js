const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeSearch, escapeLike } = require('../utils/search');
const { one } = require('../utils/embed');
const { canReceivePayouts } = require('../utils/payouts');

test('a search cannot smuggle filter syntax or wildcards into PostgREST', () => {
  // The injection the old unescaped search allowed: close the ilike, add a clause.
  assert.equal(safeSearch('a,role.eq.super_admin)'), 'a role.eq.super_admin');
  assert.equal(safeSearch('50% off*'), '50 off');
  assert.equal(safeSearch('  jazz   night '), 'jazz night');
  assert.equal(safeSearch(undefined), '');
});

test('an exact, case-insensitive name compares the characters, not a pattern', () => {
  assert.equal(escapeLike('VIP_%'), 'VIP\\_\\%');
  assert.equal(escapeLike('back\\slash'), 'back\\\\slash');
  assert.equal(escapeLike('General'), 'General');
});

test('one() unwraps every shape PostgREST returns for a to-one embed', () => {
  assert.deepEqual(one({ id: 1 }), { id: 1 });
  assert.deepEqual(one([{ id: 2 }]), { id: 2 });
  assert.equal(one([]), null);
  assert.equal(one(null), null);
});

test('payouts need both Stripe flags, and a missing organizer cannot be paid', () => {
  assert.equal(canReceivePayouts({ stripe_onboarding_complete: true, stripe_payouts_enabled: true }), true);
  assert.equal(canReceivePayouts({ stripe_onboarding_complete: true, stripe_payouts_enabled: false }), false);
  assert.equal(canReceivePayouts(null), false);
});
