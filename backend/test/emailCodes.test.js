const { test } = require('node:test');
const assert = require('node:assert/strict');
const codes = require('../services/emailCodes');

const SECRET = 'a-test-secret-long-enough-to-mean-something-0123456789';

test('a code is always six digits, including leading zeros', () => {
  for (let i = 0; i < 500; i += 1) {
    assert.match(codes.generateCode(), /^\d{6}$/);
  }
});

test('what a person pastes is forgiven, anything else is not a code', () => {
  assert.equal(codes.normaliseCode('123456'), '123456');
  assert.equal(codes.normaliseCode(' 123 456 '), '123456');
  assert.equal(codes.normaliseCode('123-456'), '123456');
  assert.equal(codes.normaliseCode('12345'), null);
  assert.equal(codes.normaliseCode('1234567'), null);
  assert.equal(codes.normaliseCode('12a456'), null);
  assert.equal(codes.normaliseCode(undefined), null);
});

test('the stored value is keyed to the account and the secret, never the code', () => {
  const a = codes.hashCode({ userId: 'user-a', code: '123456', secret: SECRET });
  assert.equal(a, codes.hashCode({ userId: 'user-a', code: '123456', secret: SECRET }), 'deterministic');
  assert.notEqual(a, codes.hashCode({ userId: 'user-b', code: '123456', secret: SECRET }),
    'the same code for two accounts must not store the same value');
  assert.notEqual(a, codes.hashCode({ userId: 'user-a', code: '123456', secret: `${SECRET}-rotated` }));
  assert.equal(a.includes('123456'), false);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('no secret, no hash — never a silent unkeyed fallback', () => {
  assert.throws(() => codes.hashCode({ userId: 'u', code: '123456', secret: '' }), /JWT_SECRET/);
});

test('the limits are the ones the migration and the routes are built around', () => {
  assert.equal(codes.CODE_LENGTH, 6);
  assert.ok(codes.MAX_ATTEMPTS <= 5, 'more guesses per code widens a six-digit space');
  assert.ok(codes.TTL_MINUTES <= 15);
  assert.ok(codes.RESEND_COOLDOWN_SECONDS >= 30);
});
