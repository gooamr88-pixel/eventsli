import { p256 } from '@noble/curves/nist.js';

import { asciiBytes, base64UrlToBytes, decodeBase64Url } from '../lib/base64';

/**
 * Is this code really ours? Checked on the phone, with no signal.
 *
 * QR v2 codes are signed by the server with ES256 (ECDSA P-256, SHA-256) and
 * carry the `kid` of the key that signed them. The phone verifies with the
 * matching PUBLIC key from GET /scan/keys (backend/services/qrSigning.js), so
 * a forged code is refused at a door in airplane mode.
 *
 * Legacy codes are HS256 with a server secret; a phone cannot check those, and
 * says so ('legacy'). What happens next is the organizer's choice
 * (gate/offlineDecision.ts).
 *
 *   valid        signed by a key this phone has
 *   invalid      not a signature of ours: refuse
 *   unknown_key  a v2 code from a key this phone does not have yet: hold
 *   legacy       an HS256 code: cannot be checked here
 */

export type SigningKey = { kid: string; kty: string; crv: string; x: string; y: string; alg?: string };

export type SignatureCheck = 'valid' | 'invalid' | 'unknown_key' | 'legacy';

function header(token: string): { alg?: string; kid?: string } | null {
  const json = decodeBase64Url(token.split('.')[0] || '');
  if (!json) return null;
  try {
    const h = JSON.parse(json);
    return h && typeof h === 'object' ? h : null;
  } catch {
    return null;
  }
}

/** The uncompressed point 04 || x || y, or null for anything but a P-256 JWK. */
function publicPoint(key: SigningKey): Uint8Array | null {
  if (key.kty !== 'EC' || key.crv !== 'P-256') return null;
  const x = base64UrlToBytes(key.x);
  const y = base64UrlToBytes(key.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) return null;
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return point;
}

export function checkSignature(token: string, keys: SigningKey[]): SignatureCheck {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return 'invalid';
  const h = header(token);
  if (!h) return 'invalid';
  if (h.alg === 'HS256') return 'legacy';
  if (h.alg !== 'ES256') return 'invalid';

  const key = keys.find((k) => k.kid === h.kid);
  const point = key ? publicPoint(key) : null;
  if (!point) return 'unknown_key';

  const signature = base64UrlToBytes(parts[2]);
  if (!signature || signature.length !== 64) return 'invalid';
  try {
    // `lowS: false` matters: the server signs with OpenSSL, which does not
    // normalise S, so about half its (perfectly valid) signatures have a high
    // S. The library's default would refuse those as malleable.
    const ok = p256.verify(signature, asciiBytes(`${parts[0]}.${parts[1]}`), point, { lowS: false });
    return ok ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}
