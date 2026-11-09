/**
 * The phone checking a code's signature with no signal (src/gate/qrVerify.ts),
 * against codes made by the BACKEND's own signing code
 * (backend/services/qrSigning.js), so the two sides cannot drift apart.
 */
import { generateKeyPairSync, randomUUID, sign as nodeSign } from 'node:crypto';
import { join } from 'node:path';

import { checkSignature, type SigningKey } from '../src/gate/qrVerify';

// The backend module, exactly as the API runs it. It needs only its own
// node_modules (jsonwebtoken), which it finds from its own folder.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrSigning = require(join(__dirname, '..', '..', 'backend', 'services', 'qrSigning.js'));

function makeKey(kid: string) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { QR_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, QR_SIGNING_KID: kid };
  const [jwk] = qrSigning.jwks(env) as SigningKey[];
  return { env, jwk, privateKey };
}

const claims = (extra = {}) => ({ typ: 'ticket', tid: randomUUID(), eid: randomUUID(), ...extra });
const b64 = (s: string) => Buffer.from(s).toString('base64url');

describe('codes the server signed', () => {
  const key = makeKey('2026-11');

  test('verify on the phone, every time: 300 codes, high S and low S alike', () => {
    let highS = 0;
    const n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    for (let i = 0; i < 300; i += 1) {
      const token: string = qrSigning.sign(claims({ v: i % 3 }), key.env);
      const s = BigInt(`0x${Buffer.from(token.split('.')[2], 'base64url').subarray(32).toString('hex')}`);
      if (s > n / BigInt(2)) highS += 1;
      expect(checkSignature(token, [key.jwk])).toBe('valid');
    }
    // OpenSSL does not normalise S; if this ever stops being true the test
    // above stops proving the `lowS: false` it exists for.
    expect(highS).toBeGreaterThan(50);
  });

  test('a changed claim breaks the signature', () => {
    const token: string = qrSigning.sign(claims(), key.env);
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64(JSON.stringify(claims()))}.${s}`;
    expect(checkSignature(forged, [key.jwk])).toBe('invalid');
  });

  test('a signature from another key under the same kid is refused', () => {
    const impostor = makeKey('2026-11');
    expect(checkSignature(qrSigning.sign(claims(), impostor.env), [key.jwk])).toBe('invalid');
  });

  test('a kid the phone has not been given yet is held, not refused', () => {
    const next = makeKey('2027-01');
    expect(checkSignature(qrSigning.sign(claims(), next.env), [key.jwk])).toBe('unknown_key');
    expect(checkSignature(qrSigning.sign(claims(), next.env), [key.jwk, next.jwk])).toBe('valid');
  });
});

describe('everything else', () => {
  const key = makeKey('k1');

  test('a legacy HS256 code cannot be checked here, and says so', () => {
    expect(checkSignature(`${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify(claims()))}.c2ln`, [key.jwk])).toBe('legacy');
  });

  test('"none", other algorithms and broken codes are invalid', () => {
    const body = b64(JSON.stringify(claims()));
    expect(checkSignature(`${b64('{"alg":"none"}')}.${body}.`, [key.jwk])).toBe('invalid');
    expect(checkSignature(`${b64('{"alg":"RS256","kid":"k1"}')}.${body}.c2ln`, [key.jwk])).toBe('invalid');
    expect(checkSignature('not.a.token!', [key.jwk])).toBe('invalid');
    expect(checkSignature('onlyonepart', [key.jwk])).toBe('invalid');
    expect(checkSignature(`${b64('{"alg":"ES256","kid":"k1"}')}.${body}.${b64('short')}`, [key.jwk])).toBe('invalid');
  });

  test('a DER-encoded signature (not the JOSE raw r||s) is not accepted', () => {
    const input = `${b64('{"alg":"ES256","kid":"k1"}')}.${b64(JSON.stringify(claims()))}`;
    const der = nodeSign('sha256', Buffer.from(input), key.privateKey).toString('base64url');
    expect(checkSignature(`${input}.${der}`, [key.jwk])).toBe('invalid');
    const raw = nodeSign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(checkSignature(`${input}.${raw}`, [key.jwk])).toBe('valid');
  });

  test('a malformed published key is treated as no key', () => {
    const token: string = qrSigning.sign(claims(), key.env);
    expect(checkSignature(token, [{ ...key.jwk, x: 'AAAA' }])).toBe('unknown_key');
    expect(checkSignature(token, [{ ...key.jwk, crv: 'P-384' }])).toBe('unknown_key');
  });
});
