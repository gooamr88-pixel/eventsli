const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../services/sponsorshipRules');

/** Sponsorship rules with no database (2026-11-20). */

test('a schedule must add up to the amount exactly', () => {
  const due = '2026-12-01T00:00:00.000Z';
  assert.deepEqual(R.cleanSchedule(1000, [{ amountCents: 600, dueAt: due }, { label: ' Final ', amountCents: 400, dueAt: due }]), [
    { label: 'Payment 1', amount_cents: 600, due_at: due },
    { label: 'Final', amount_cents: 400, due_at: due },
  ]);
  assert.equal(R.cleanSchedule(1000, [{ amountCents: 1000, dueAt: due }])[0].label, 'Full payment');
  assert.throws(() => R.cleanSchedule(1000, [{ amountCents: 999, dueAt: due }]), /add up to 999/);
  assert.throws(() => R.cleanSchedule(1000, []), /at least one payment/);
  assert.throws(() => R.cleanSchedule(1000, [{ amountCents: 0, dueAt: due }, { amountCents: 1000, dueAt: due }]), /above zero/);
  assert.throws(() => R.cleanSchedule(1000, [{ amountCents: 1000, dueAt: 'soon' }]), /due date/);
  assert.throws(() => R.cleanSchedule(1000, Array.from({ length: 13 }, () => ({ amountCents: 1, dueAt: due }))), /At most 12/);
});

test('an in-kind sponsorship has no schedule', () => {
  assert.deepEqual(R.cleanSchedule(0, []), []);
  assert.deepEqual(R.cleanSchedule(0, undefined), []);
  assert.throws(() => R.cleanSchedule(0, [{ amountCents: 1, dueAt: '2026-12-01' }]), /in-kind/);
  assert.throws(() => R.cleanSchedule(-1, []), /whole number/);
  assert.throws(() => R.cleanSchedule(10.5, []), /whole number/);
});

test('a suggested schedule sums to the amount, odd cents on the deposit', () => {
  const s = R.suggestSchedule(100001, 3, { now: new Date('2026-11-20'), eventStartsAt: '2027-03-01' });
  assert.equal(s.length, 3);
  assert.equal(s.reduce((n, x) => n + x.amountCents, 0), 100001);
  assert.deepEqual(s.map((x) => x.amountCents), [33335, 33333, 33333]);
  assert.equal(s[0].label, 'Deposit');
  assert.ok(new Date(s[2].dueAt) < new Date('2027-03-01'), 'the last payment falls before the event');
  // The suggestion is a valid schedule as it stands.
  assert.equal(R.cleanSchedule(100001, s).length, 3);
  assert.deepEqual(R.suggestSchedule(0, 3), []);
  assert.equal(R.suggestSchedule(500, 1)[0].label, 'Full payment');
});

test('status reads a signed deal together with its money', () => {
  assert.equal(R.status({ stage: 'lead' }), 'lead');
  assert.equal(R.status({ stage: 'signed', amount_cents: 100, paid_cents: 0 }), 'signed');
  assert.equal(R.status({ stage: 'signed', amount_cents: 100, paid_cents: 40 }), 'part_paid');
  assert.equal(R.status({ stage: 'signed', amount_cents: 100, paid_cents: 100 }), 'paid');
  assert.equal(R.status({ stage: 'signed', amount_cents: 0, paid_cents: 0 }), 'paid');
  assert.equal(R.boardColumn({ stage: 'signed', amount_cents: 100, paid_cents: 40 }), 'signed');
  assert.equal(R.boardColumn({ stage: 'lost' }), 'closed');
  assert.equal(R.boardColumn({ stage: 'cancelled' }), 'closed');
});

test('benefits are trimmed, blank lines dropped, bounded', () => {
  assert.deepEqual(R.cleanBenefits([' Logo ', '', null, 'Booth']), ['Logo', 'Booth']);
  assert.deepEqual(R.cleanBenefits(undefined), []);
  assert.throws(() => R.cleanBenefits('Logo'), /one item per line/);
  assert.throws(() => R.cleanBenefits(['x'.repeat(121)]), /120/);
  assert.throws(() => R.cleanBenefits(Array.from({ length: 31 }, () => 'b')), /30/);
});

test('the platform fee is basis points, capped, never negative', () => {
  assert.equal(R.feeFor(100000, 0), 0);
  assert.equal(R.feeFor(100000, 250), 2500);
  assert.equal(R.feeFor(100000, 99999), 30000);
  assert.equal(R.feeFor(100000, -5), 0);
  assert.equal(R.feeFor(333, 100), 3);
});

test('a logo must be this event\'s own sponsor object', () => {
  const ev = '11111111-1111-1111-1111-111111111111';
  assert.equal(R.ownSponsorLogo(ev, `events/${ev}/sponsor-0123456789abcdef.png`), true);
  assert.equal(R.ownSponsorLogo(ev, `events/${ev}/cover-0123456789abcdef.png`), false);
  assert.equal(R.ownSponsorLogo(ev, `events/other/sponsor-0123456789abcdef.png`), false);
  assert.equal(R.ownSponsorLogo(ev, `events/${ev}/../x/sponsor-0123456789abcdef.png`), false);
  assert.equal(R.ownSponsorLogo(ev, null), false);
});

test('database codes become the API\'s codes with a sentence', () => {
  const e = R.fromDb({ message: 'SPONSORSHIP_SOLD_OUT' });
  assert.equal(e.code, 'SPONSORSHIP_SOLD_OUT');
  assert.match(e.message, /taken/);
  assert.equal(R.fromDb({ message: 'SPONSORSHIP_NOT_SIGNED' }).code, 'SPONSORSHIP_WRONG_STAGE');
  assert.equal(R.fromDb({ message: 'SPONSORSHIP_SCHEDULE_MISMATCH' }).code, 'VALIDATION_ERROR');
  const unknown = R.fromDb({ message: 'relation does not exist' });
  assert.equal(unknown.code, undefined, 'an unexpected database error stays a 500');
});

test('an expired proposal is only a proposal past its date', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(R.isExpired({ stage: 'proposal', proposal_expires_at: '2026-11-20T11:00:00Z' }, now), true);
  assert.equal(R.isExpired({ stage: 'proposal', proposal_expires_at: '2026-11-21T00:00:00Z' }, now), false);
  assert.equal(R.isExpired({ stage: 'proposal', proposal_expires_at: null }, now), false);
  assert.equal(R.isExpired({ stage: 'signed', proposal_expires_at: '2026-11-20T11:00:00Z' }, now), false);
});
