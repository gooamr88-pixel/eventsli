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
