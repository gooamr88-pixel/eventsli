const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../services/vendorRules');

/** Vendor rules with no database (2026-11-20). */

test('questions keep stable, unique ids and known types', () => {
  const q = R.cleanQuestions([
    { id: 'power', label: ' Need power? ', type: 'yesno', required: true },
    { label: 'Menu', type: 'essay' },
    { id: 'power', label: 'Again' },
  ]);
  assert.deepEqual(q, [
    { id: 'power', label: 'Need power?', type: 'yesno', required: true },
    { id: 'q2', label: 'Menu', type: 'text', required: false },
    { id: 'powerx', label: 'Again', type: 'text', required: false },
  ]);
  assert.throws(() => R.cleanQuestions([{ label: '' }]), /needs some words/);
  assert.throws(() => R.cleanQuestions(Array.from({ length: 11 }, (_, i) => ({ label: `Q${i}` }))), /At most 10/);
});

test('answers follow the questions; required ones must be given', () => {
  const qs = [{ id: 'p', label: 'Power?', type: 'yesno', required: true }, { id: 'm', label: 'Menu', type: 'long', required: false }];
  assert.deepEqual(R.cleanAnswers(qs, { p: true, m: '  Tacos ', extra: 'ignored' }), [
    { id: 'p', label: 'Power?', answer: 'Yes' }, { id: 'm', label: 'Menu', answer: 'Tacos' },
  ]);
  assert.equal(R.cleanAnswers(qs, { p: 'no' })[0].answer, 'No');
  assert.throws(() => R.cleanAnswers(qs, {}), /Please answer: Power\?/);
  assert.throws(() => R.cleanAnswers(qs, null), /Power/);
  assert.equal(R.cleanAnswers(qs, { p: true, m: 'x'.repeat(2000) })[1].answer.length, 1000);
});

test('lists are trimmed, de-duplicated and bounded', () => {
  assert.deepEqual(R.cleanList(['Food', ' Food ', '', 'Merch']), ['Food', 'Merch']);
  assert.throws(() => R.cleanList('Food', { what: 'categories' }), /categories one per line/);
  assert.throws(() => R.cleanList(['a', 'b', 'c'], { max: 2, what: 'categories' }), /At most 2 categories/);
});

test('staff never exceed the passes', () => {
  assert.deepEqual(R.cleanStaff(['Ana', 'Sam'], 2), ['Ana', 'Sam']);
  assert.throws(() => R.cleanStaff(['Ana', 'Sam', 'Lee'], 2), /at most 2 people/);
  assert.throws(() => R.cleanStaff(['Ana', 'Sam'], 1), /1 staff pass/);
  assert.deepEqual(R.cleanStaff([], 0), []);
});

test('status and board column', () => {
  assert.equal(R.status({ stage: 'confirmed', paid_at: null }), 'confirmed');
  assert.equal(R.status({ stage: 'confirmed', paid_at: '2026-11-20' }), 'paid');
  assert.equal(R.boardColumn({ stage: 'withdrawn' }), 'closed');
  assert.equal(R.boardColumn({ stage: 'waitlisted' }), 'waitlisted');
});

test('applications are open while the program is on and before its deadline', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(R.applicationsOpen({ is_open: true }, now), true);
  assert.equal(R.applicationsOpen({ is_open: false }, now), false);
  assert.equal(R.applicationsOpen({ is_open: true, applications_close_at: '2026-11-20T11:00:00Z' }, now), false);
  assert.equal(R.applicationsOpen({ isOpen: true, applicationsCloseAt: '2026-11-21T00:00:00Z' }, now), true);
  assert.equal(R.applicationsOpen(null, now), false);
});

test('an expired offer, a logo, and database codes', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(R.isExpired({ stage: 'offered', offer_expires_at: '2026-11-20T11:00:00Z' }, now), true);
  assert.equal(R.isExpired({ stage: 'confirmed', offer_expires_at: '2026-11-20T11:00:00Z' }, now), false);
  const ev = '11111111-1111-1111-1111-111111111111';
  assert.equal(R.ownVendorLogo(ev, `events/${ev}/vendor-0123456789abcdef.webp`), true);
  assert.equal(R.ownVendorLogo(ev, `events/${ev}/sponsor-0123456789abcdef.webp`), false);
  assert.equal(R.fromDb({ message: 'VENDOR_SOLD_OUT' }).code, 'VENDOR_SOLD_OUT');
  assert.equal(R.fromDb({ message: 'VENDOR_NOT_CONFIRMED' }).code, 'VENDOR_WRONG_STAGE');
  assert.equal(R.fromDb({ message: 'boom' }).code, undefined);
});
