const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transferProof } = require('../utils/ticketTransfer');

/**
 * Who may transfer a ticket — every case of the pure decision. The integration
 * suite (fulfillment.test.js) runs the same rules through the database.
 */
const ORDER = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const guestOrder = { id: ORDER, user_id: null, guest_email: 'Buyer@Example.com' };
const accountOrder = { id: ORDER, user_id: 'user-1', guest_email: 'buyer@example.com' };

test('the account that bought it may transfer it', () => {
  assert.equal(transferProof(accountOrder, { userId: 'user-1', email: 'anything@example.com' }), 'account');
});

test("another account may not — not even with the buyer's address", () => {
  assert.equal(transferProof(accountOrder, { userId: 'user-2', email: 'buyer@example.com' }), null);
  assert.equal(transferProof(accountOrder, { userId: 'user-2', email: 'x@example.com', tokenOrderId: ORDER }), null);
});

test('a guest purchase: a verified account on the same address may, whatever the case', () => {
  assert.equal(transferProof(guestOrder, { userId: 'user-9', email: '  buyer@example.COM ' }), 'guest-email');
});

test('a guest purchase: the signed token for THIS order may', () => {
  assert.equal(transferProof(guestOrder, { userId: 'user-9', email: 'someone@example.com', tokenOrderId: ORDER }), 'guest-token');
});

test("THE FIX: knowing the buyer's address is not proof — only being signed in as it is", () => {
  // The old `proofEmail` path: a stranger (e.g. the organizer, who sees the
  // address on the door list) typing the buyer's email. The service no longer
  // takes a typed address at all; the only email it sees is the session's.
  assert.equal(transferProof(guestOrder, { userId: 'organizer', email: 'organizer@example.com' }), null);
});

test("a token for another order, or a forged one (read as null), proves nothing", () => {
  assert.equal(transferProof(guestOrder, { userId: 'u', email: 'x@example.com', tokenOrderId: OTHER }), null);
  assert.equal(transferProof(guestOrder, { userId: 'u', email: 'x@example.com', tokenOrderId: null }), null);
});

test('missing data fails closed', () => {
  assert.equal(transferProof(null, { userId: 'user-1' }), null);
  assert.equal(transferProof(guestOrder, null), null);
  assert.equal(transferProof({ id: ORDER, user_id: null, guest_email: null }, { userId: 'u', email: null }), null);
  assert.equal(transferProof({ id: ORDER, user_id: null, guest_email: '' }, { userId: 'u', email: '' }), null);
  assert.equal(transferProof({ id: null, user_id: null, guest_email: null }, { tokenOrderId: null }), null);
});
