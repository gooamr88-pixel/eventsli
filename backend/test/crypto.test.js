const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.IP_HASH_SALT = process.env.IP_HASH_SALT || 'test-salt-for-unit-tests';

const {
  hashPassword, verifyPassword, hashIp, randomToken, hashToken, safeEqual,
  PBKDF2_ITERATIONS,
} = require('../utils/crypto');

test('a hash is self-describing, so the cost can be raised later', async () => {
  const h = await hashPassword('a-perfectly-fine-passphrase');
  const [algo, iters, salt, digest] = h.split('$');
  assert.equal(algo, 'pbkdf2');
  assert.equal(Number(iters), PBKDF2_ITERATIONS);
  assert.ok(salt.length > 0 && digest.length > 0);
});

test('the same password hashes differently every time', async () => {
  const a = await hashPassword('same-input-both-times');
  const b = await hashPassword('same-input-both-times');
  assert.notEqual(a, b, 'a shared salt would let one rainbow table cover every user');
  assert.equal((await verifyPassword('same-input-both-times', a)).ok, true);
  assert.equal((await verifyPassword('same-input-both-times', b)).ok, true);
});

test('verification accepts the right password and rejects the rest', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.equal((await verifyPassword('correct horse battery staple', h)).ok, true);
  assert.equal((await verifyPassword('correct horse battery stapl', h)).ok, false);
  assert.equal((await verifyPassword('', h)).ok, false);
  assert.equal((await verifyPassword('CORRECT HORSE BATTERY STAPLE', h)).ok, false);
});

test('an account with no password can never authenticate by password', async () => {
  // OAuth-only rows carry a NULL hash. This must be a plain rejection, not a
  // throw — a 500 here would tell an attacker the address exists but has no
  // password set, which is exactly the account worth targeting.
  for (const stored of [null, undefined, '', 'not-a-hash', 'bcrypt$whatever']) {
    const r = await verifyPassword('anything', stored);
    assert.equal(r.ok, false);
    assert.equal(r.needsRehash, false);
  }
});

test('a hash at a lower cost verifies, and asks to be upgraded', async () => {
  // Simulates a row written before the iteration count was raised.
  const crypto = require('node:crypto');
  const { promisify } = require('node:util');
  const pbkdf2 = promisify(crypto.pbkdf2);
  const salt = crypto.randomBytes(16);
  const weak = await pbkdf2('legacy-password-here', salt, 1000, 64, 'sha512');
  const stored = `pbkdf2$1000$${salt.toString('base64')}$${weak.toString('base64')}`;

  const r = await verifyPassword('legacy-password-here', stored);
  assert.equal(r.ok, true, 'an old hash must still let its owner in');
  assert.equal(r.needsRehash, true, 'and must be flagged for silent upgrade');

  // A wrong password against an old hash is rejected, and asks for nothing.
  const bad = await verifyPassword('wrong', stored);
  assert.equal(bad.ok, false);
  assert.equal(bad.needsRehash, false);
});

test('a corrupt hash is rejected rather than throwing', async () => {
  for (const junk of ['pbkdf2$', 'pbkdf2$abc$x$y', 'pbkdf2$1000$$', 'pbkdf2$1000$AAAA']) {
    const r = await verifyPassword('anything', junk);
    assert.equal(r.ok, false);
  }
});

test('IP hashing is stable, salted, and not reversible to a length', () => {
  const a = hashIp('203.0.113.7');
  const b = hashIp('203.0.113.7');
  const c = hashIp('203.0.113.8');
  assert.equal(a, b, 'the same address must group together');
  assert.notEqual(a, c);
  assert.equal(a.length, 32);
  assert.equal(hashIp(null), null);
});

test('rotating the salt anonymises every historical row', () => {
  const before = hashIp('198.51.100.1');
  process.env.IP_HASH_SALT = 'a-different-salt';
  const after = hashIp('198.51.100.1');
  process.env.IP_HASH_SALT = 'test-salt-for-unit-tests';
  assert.notEqual(before, after);
});

test('tokens are url-safe and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const t = randomToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/, 'must survive being put in a URL unencoded');
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test('a token is stored only as its digest', () => {
  const t = randomToken();
  const h = hashToken(t);
  assert.notEqual(h, t);
  assert.equal(h.length, 64);
  assert.equal(hashToken(t), h, 'must be deterministic, or lookup fails');
});

test('safeEqual compares without leaking length or content', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false, 'a length mismatch must not throw');
  assert.equal(safeEqual('', ''), true);
});
