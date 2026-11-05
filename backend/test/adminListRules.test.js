const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const { auditListRules, invoiceListRules } = require('../routes/admin/listRules');

/** Runs a rule list over a bare request and returns the offending fields. */
async function errorsFor(rules, query) {
  const req = { query };
  for (const rule of rules) await rule.run(req);
  return validationResult(req).array().map((e) => e.path);
}

test('the audit log takes an ISO date for since, or none', async () => {
  assert.deepEqual(await errorsFor(auditListRules, {}), []);
  assert.deepEqual(await errorsFor(auditListRules, { since: '2026-10-06T12:00:00.000Z' }), []);
  assert.deepEqual(await errorsFor(auditListRules, { since: 'last month' }), ['since']);
  assert.deepEqual(await errorsFor(auditListRules, { since: "2026-10-06' or 1=1" }), ['since']);
});

test('the invoice list takes a UUID organizer, an ISO date and a short search', async () => {
  assert.deepEqual(await errorsFor(invoiceListRules, {}), []);
  assert.deepEqual(await errorsFor(invoiceListRules, {
    organizerId: '3f1c2a9e-1b2c-4d5e-8f90-123456789abc',
    issuedSince: '2026-08-07T00:00:00Z',
    q: 'INV-1042',
  }), []);
});

test('anything else is refused before it reaches a filter', async () => {
  assert.deepEqual(await errorsFor(invoiceListRules, { organizerId: 'not-an-id' }), ['organizerId']);
  assert.deepEqual(await errorsFor(invoiceListRules, { issuedSince: 'yesterday' }), ['issuedSince']);
  assert.deepEqual(await errorsFor(invoiceListRules, { q: 'x'.repeat(201) }), ['q']);
});
