const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isInvoiceOverdue } = require('../utils/invoices');

const now = new Date('2026-09-15T12:00:00Z');
const past = '2026-09-14T12:00:00Z';
const future = '2026-09-16T12:00:00Z';

test('an invoice the job labelled overdue is overdue', () => {
  // The bug: this came back false, on exactly the invoices that shut gates.
  assert.equal(isInvoiceOverdue({ status: 'overdue', due_at: past }, now), true);
  assert.equal(isInvoiceOverdue({ status: 'overdue', due_at: future }, now), true);
});

test('an unpaid invoice past its due date is overdue before the job runs', () => {
  assert.equal(isInvoiceOverdue({ status: 'open', due_at: past }, now), true);
  assert.equal(isInvoiceOverdue({ status: 'submitted', dueAt: past }, now), true);
});

test('an unpaid invoice inside its window is not', () => {
  assert.equal(isInvoiceOverdue({ status: 'open', due_at: future }, now), false);
});

test('a settled invoice never is', () => {
  assert.equal(isInvoiceOverdue({ status: 'paid', due_at: past }, now), false);
  assert.equal(isInvoiceOverdue({ status: 'waived', due_at: past }, now), false);
});

test('missing data is not overdue', () => {
  assert.equal(isInvoiceOverdue(null, now), false);
  assert.equal(isInvoiceOverdue({ status: 'open' }, now), false);
});

// ─── The admin list's totals and search (sumInvoiceTotals, invoiceSearchFilter)

const { sumInvoiceTotals, invoiceSearchFilter } = require('../utils/invoices');

test('totals are per currency and never mix CAD with USD', () => {
  const t = sumInvoiceTotals([
    { currency: 'CAD', amount_cents: 1000, status: 'open' },
    { currency: 'USD', amount_cents: 500, status: 'paid' },
    { currency: 'CAD', amount_cents: 250, status: 'paid' },
  ]);
  assert.equal(t.count, 3);
  assert.deepEqual(t.byCurrency.CAD, { totalCents: 1250, unpaidCents: 1000, settledCents: 250 });
  assert.deepEqual(t.byCurrency.USD, { totalCents: 500, unpaidCents: 0, settledCents: 500 });
});

test('every unpaid status counts as unpaid; waived counts as nothing owed', () => {
  const t = sumInvoiceTotals([
    { currency: 'CAD', amount_cents: 100, status: 'open' },
    { currency: 'CAD', amount_cents: 200, status: 'submitted' },
    { currency: 'CAD', amount_cents: 400, status: 'overdue' },
    { currency: 'CAD', amount_cents: 800, status: 'waived' },
  ]);
  assert.equal(t.count, 4, 'a waived invoice is still an invoice');
  assert.deepEqual(t.byCurrency.CAD, { totalCents: 700, unpaidCents: 700, settledCents: 0 });
});

test('amounts that arrive as strings or nothing do not break the sums', () => {
  const t = sumInvoiceTotals([
    { currency: 'CAD', amount_cents: '1500', status: 'paid' },
    { currency: 'CAD', amount_cents: null, status: 'open' },
  ]);
  assert.deepEqual(t.byCurrency.CAD, { totalCents: 1500, unpaidCents: 0, settledCents: 1500 });
});

test('no invoices is zero, not an error', () => {
  assert.deepEqual(sumInvoiceTotals([]), { count: 0, byCurrency: {} });
  assert.deepEqual(sumInvoiceTotals(null), { count: 0, byCurrency: {} });
});

test('an empty search adds no filter', () => {
  assert.equal(invoiceSearchFilter('', ['00000000-0000-4000-8000-000000000001']), null);
});

test('a search matches the invoice number, and the matched events by id', () => {
  const id = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';
  assert.equal(invoiceSearchFilter('INV-12', [id]), `number.ilike.%INV-12%,event_id.in.(${id})`);
  assert.equal(invoiceSearchFilter('INV-12', []), 'number.ilike.%INV-12%');
});

test('only UUIDs can reach the event id list', () => {
  const id = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';
  assert.equal(
    invoiceSearchFilter('x', [id, 'abc),status.eq.paid', '', null]),
    `number.ilike.%x%,event_id.in.(${id})`,
  );
});
