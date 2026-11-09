const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * QR v2: ticket codes signed with ES256 so a door with no signal can check
 * them with a public key, alongside the legacy HS256 codes already in inboxes.
 */

process.env.QR_JWT_SECRET = process.env.QR_JWT_SECRET || 'legacy-qr-secret-for-tests-0123456789abcdef';
// No database: the Supabase client is replaced before the service loads.
const path = require('node:path');
const file = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { supabase: {} } };
const qrSigning = require('../services/qrSigning');
const tickets = require('../services/ticketService');

const ENV_KEYS = ['QR_SIGNING_KEY', 'QR_SIGNING_KID', 'QR_SIGNING_RETIRED_KEYS'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
after(() => ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

function newKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

const T = '6a4c3b2a-1111-4222-8333-444455556666';
const E = '0f0e0d0c-aaaa-4bbb-8ccc-dddd00001111';

beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

test('without a signing key, codes stay legacy HS256 and still read back', () => {
  const token = tickets.issueQrToken({ ticketId: T, eventId: E });
  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'HS256');
  assert.deepEqual(tickets.decodeQrToken(token), { ticketId: T, eventId: E, version: 0, format: 'legacy' });
});

test('with a key, new codes are ES256 with its kid, no iat, and read back as v2', () => {
  const k = newKey();
  process.env.QR_SIGNING_KEY = k.priv;
  process.env.QR_SIGNING_KID = '2026-11';
  const token = tickets.issueQrToken({ ticketId: T, eventId: E, version: 2 });
  const { header, payload } = jwt.decode(token, { complete: true });
  assert.deepEqual(header, { alg: 'ES256', kid: '2026-11' });
  assert.deepEqual(payload, { typ: 'ticket', tid: T, eid: E, v: 2 });
  assert.deepEqual(tickets.decodeQrToken(token), { ticketId: T, eventId: E, version: 2, format: 'v2' });
  // The signature is the raw 64-byte r||s a device verifies, not DER.
  assert.equal(Buffer.from(token.split('.')[2], 'base64url').length, 64);
});

test('the key may be written on one line with \\n, as .env wants it', () => {
  process.env.QR_SIGNING_KEY = newKey().priv.trim().replace(/\n/g, '\\n');
  process.env.QR_SIGNING_KID = 'one-line';
  const token = tickets.issueQrToken({ ticketId: T, eventId: E });
  assert.equal(tickets.decodeQrToken(token).format, 'v2');
});

test('legacy codes keep working after the key is added', () => {
  const legacy = tickets.issueQrToken({ ticketId: T, eventId: E });
  process.env.QR_SIGNING_KEY = newKey().priv;
  process.env.QR_SIGNING_KID = 'k1';
  assert.equal(tickets.decodeQrToken(legacy).format, 'legacy');
});

test('a v2 code with a changed claim, another key, or an unknown kid is refused', () => {
  const k = newKey();
  process.env.QR_SIGNING_KEY = k.priv;
  process.env.QR_SIGNING_KID = 'k1';
  const token = tickets.issueQrToken({ ticketId: T, eventId: E });
  const [h, , s] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ typ: 'ticket', tid: T, eid: 'another-event' })).toString('base64url');
  assert.equal(tickets.decodeQrToken(`${h}.${forgedBody}.${s}`), null);

  const stranger = jwt.sign({ typ: 'ticket', tid: T, eid: E }, newKey().priv, { algorithm: 'ES256', keyid: 'k1' });
  assert.equal(tickets.decodeQrToken(stranger), null, 'right kid, wrong key');

  const unknown = jwt.sign({ typ: 'ticket', tid: T, eid: E }, k.priv, { algorithm: 'ES256', keyid: 'k9' });
  assert.equal(tickets.decodeQrToken(unknown), null, 'a kid this server does not know');
});

test('algorithm confusion: an HS256 code keyed with the PUBLIC key is not ours', () => {
  const k = newKey();
  process.env.QR_SIGNING_KEY = k.priv;
  process.env.QR_SIGNING_KID = 'k1';
  // jsonwebtoken refuses to HMAC with a PEM, so build it by hand.
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'HS256', kid: 'k1' })}.${enc({ typ: 'ticket', tid: T, eid: E })}`;
  const sig = crypto.createHmac('sha256', k.pub).update(input).digest('base64url');
  assert.equal(tickets.decodeQrToken(`${input}.${sig}`), null);
  assert.equal(tickets.decodeQrToken(`${enc({ alg: 'none' })}.${enc({ typ: 'ticket', tid: T, eid: E })}.`), null);
});

test('a retired key still verifies the codes it signed; the current key signs new ones', () => {
  const old = newKey();
  process.env.QR_SIGNING_KEY = old.priv;
  process.env.QR_SIGNING_KID = '2026-10';
  const oldToken = tickets.issueQrToken({ ticketId: T, eventId: E });

  process.env.QR_SIGNING_KEY = newKey().priv;
  process.env.QR_SIGNING_KID = '2026-11';
  process.env.QR_SIGNING_RETIRED_KEYS = JSON.stringify({ '2026-10': old.pub });
  assert.equal(tickets.decodeQrToken(oldToken).format, 'v2');
  assert.equal(jwt.decode(tickets.issueQrToken({ ticketId: T, eventId: E }), { complete: true }).header.kid, '2026-11');
  assert.deepEqual(qrSigning.jwks().map((k) => k.kid).sort(), ['2026-10', '2026-11']);
});

test('the published keys are public JWKs only', () => {
  process.env.QR_SIGNING_KEY = newKey().priv;
  process.env.QR_SIGNING_KID = 'k1';
  const [jwk] = qrSigning.jwks();
  assert.deepEqual(Object.keys(jwk).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
  assert.equal(jwk.d, undefined, 'never the private scalar');
  assert.equal(Buffer.from(jwk.x, 'base64url').length, 32);
});

test('a broken configuration is refused at boot, readably', () => {
  assert.throws(() => qrSigning.assertConfig({ QR_SIGNING_KEY: 'not a key', QR_SIGNING_KID: 'k1' }), /not a readable private key/);
  assert.throws(() => qrSigning.assertConfig({ QR_SIGNING_KEY: newKey().priv }), /QR_SIGNING_KID/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => qrSigning.assertConfig({ QR_SIGNING_KEY: rsa, QR_SIGNING_KID: 'k1' }), /EC P-256/);
  const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => qrSigning.assertConfig({ QR_SIGNING_KEY: p384, QR_SIGNING_KID: 'k1' }), /EC P-256/);
  assert.throws(() => qrSigning.assertConfig({ QR_SIGNING_RETIRED_KEYS: '{not json' }), /JSON/);
  assert.doesNotThrow(() => qrSigning.assertConfig({}));
});
