const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// No database: the Supabase client is replaced before the service loads.
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase: {} } };
const { publicBreakdown } = require('../services/pricingService');

/**
 * The buyer's "Card processing fee" line (owner, 2026-11-19).
 *
 * It was "Service fee", and the owner asked why Stripe's percentage did not
 * appear. The line now says what it is, and carries the rate it was worked
 * out from so the checkout can say so in a note. The rule that matters: the
 * note quotes the rate ACTUALLY used, so Stripe's in auto mode and the
 * admin's own in manual mode.
 */

function quote({ feeBearer = 'buyer', paymentFeeCents = 315, basis } = {}) {
  return {
    breakdown: {
      subtotalCents: 9500, discountCents: 0, eventTaxCents: 0,
      feeBearer, paymentFeeCents, buyerTotalCents: 9500 + (feeBearer === 'buyer' ? paymentFeeCents : 0),
    },
    paymentFeeBasis: basis === undefined ? { mode: 'auto', pct: 2.9, fixedCents: 30 } : basis,
    ticketSubtotalCents: 9500,
    addons: [],
    admits: 1,
    event: { currency: 'CAD', title: 'Gala', slug: 'gala', organizers: null },
    reservation: { created_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() },
  };
}

test('the buyer-paid fee is a "Card processing fee" carrying Stripe\'s rate in auto mode', () => {
  const line = publicBreakdown(quote()).lines.find((l) => l.label === 'Card processing fee');
  assert.ok(line);
  assert.equal(line.amountCents, 315);
  assert.deepEqual(line.basis, { mode: 'auto', pct: 2.9, fixedCents: 30 });
  assert.equal(publicBreakdown(quote()).lines.some((l) => l.label === 'Service fee'), false);
});

test('manual mode carries the admin\'s rate, never Stripe\'s', () => {
  const basis = { mode: 'manual', pct: 3.5, fixedCents: 50 };
  const line = publicBreakdown(quote({ basis })).lines.find((l) => l.label === 'Card processing fee');
  assert.deepEqual(line.basis, basis);
});

test('no fee line when the organizer pays it, or when there is no fee', () => {
  assert.equal(publicBreakdown(quote({ feeBearer: 'organizer' })).lines.some((l) => /fee/i.test(l.label)), false);
  assert.equal(publicBreakdown(quote({ paymentFeeCents: 0 })).lines.some((l) => /fee/i.test(l.label)), false);
});

test('an offline quote (no card) has no basis, and the line, if any, carries none', () => {
  const b = publicBreakdown(quote({ basis: null }));
  const line = b.lines.find((l) => l.label === 'Card processing fee');
  assert.equal(line?.basis, undefined);
});
