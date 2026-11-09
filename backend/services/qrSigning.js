const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Ticket codes a door can check WITHOUT a connection (QR v2).
 *
 * A legacy code is signed with QR_JWT_SECRET (HS256). Checking it needs that
 * secret, and a secret on thousands of phones is no secret, so a phone with no
 * signal could only trust a legacy code because its ticket id was on the
 * event's list.
 *
 * A v2 code is signed with ES256 (ECDSA P-256, SHA-256): the server signs with
 * a private key only it holds, and every device verifies with the matching
 * PUBLIC key from GET /scan/keys. A phone in airplane mode can then tell a
 * forged code from one of ours, which is what lets it admit people offline.
 *
 * Configuration (backend/.env, see .env.example):
 *   QR_SIGNING_KEY          the private key, PKCS#8 PEM. Newlines may be
 *                           written as \n so it fits on one line.
 *   QR_SIGNING_KID          a short name for it, carried in every code ("kid")
 *                           so devices know which public key to use.
 *   QR_SIGNING_RETIRED_KEYS optional JSON {"kid": "public PEM"} of keys that
 *                           are no longer used to sign but whose codes are
 *                           still out there. Rotation: generate a new key, move
 *                           the old public key here, and keep it until the last
 *                           event it signed for is over.
 *
 * Unset, everything keeps working: codes stay legacy and devices fall back to
 * the event list (and the organizer's "older codes" setting) when offline.
 * Set but wrong, the API refuses to start (app.js): a typo in a key must not
 * become a night of tickets that no door can read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KID_RE = /^[A-Za-z0-9._-]{1,32}$/;

const pem = (value) => String(value || '').replace(/\\n/g, '\n').trim();

function ensureP256(keyObject, label) {
  const curve = keyObject.asymmetricKeyDetails?.namedCurve;
  if (keyObject.asymmetricKeyType !== 'ec' || curve !== 'prime256v1') {
    throw new Error(`${label} must be an EC P-256 key (got ${keyObject.asymmetricKeyType}${curve ? ` ${curve}` : ''})`);
  }
}

function load(env) {
  const out = { signing: null, publicKeys: new Map() };

  if (env.QR_SIGNING_KEY) {
    const kid = String(env.QR_SIGNING_KID || '').trim();
    if (!KID_RE.test(kid)) throw new Error('QR_SIGNING_KID must be 1-32 characters of A-Z a-z 0-9 . _ -');
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(pem(env.QR_SIGNING_KEY));
    } catch (err) {
      throw new Error(`QR_SIGNING_KEY is not a readable private key: ${err.message}`);
    }
    ensureP256(privateKey, 'QR_SIGNING_KEY');
    out.signing = { kid, privateKey };
    out.publicKeys.set(kid, crypto.createPublicKey(privateKey));
  }

  if (env.QR_SIGNING_RETIRED_KEYS) {
    let retired;
    try {
      retired = JSON.parse(env.QR_SIGNING_RETIRED_KEYS);
    } catch {
      throw new Error('QR_SIGNING_RETIRED_KEYS must be JSON: {"kid": "-----BEGIN PUBLIC KEY-----..."}');
    }
    for (const [kid, value] of Object.entries(retired || {})) {
      if (!KID_RE.test(kid)) throw new Error(`QR_SIGNING_RETIRED_KEYS: "${kid}" is not a valid kid`);
      if (out.publicKeys.has(kid)) throw new Error(`QR_SIGNING_RETIRED_KEYS: "${kid}" is also the current kid`);
      let key;
      try {
        key = crypto.createPublicKey(pem(value));
      } catch (err) {
        throw new Error(`QR_SIGNING_RETIRED_KEYS: "${kid}" is not a readable public key: ${err.message}`);
      }
      ensureP256(key, `QR_SIGNING_RETIRED_KEYS "${kid}"`);
      out.publicKeys.set(kid, key);
    }
  }
  return out;
}

// Parsed once per configuration; tests change the environment between cases.
let cached = { fingerprint: null, value: null };
function keys(env = process.env) {
  const fingerprint = `${env.QR_SIGNING_KEY || ''}|${env.QR_SIGNING_KID || ''}|${env.QR_SIGNING_RETIRED_KEYS || ''}`;
  if (cached.fingerprint !== fingerprint) cached = { fingerprint, value: load(env) };
  return cached.value;
}

/** The key new codes are signed with, or null (legacy codes). */
function signingKey(env) {
  return keys(env).signing;
}

/** The public key for a `kid`, or null if this server does not know it. */
function publicKey(kid, env) {
  return keys(env).publicKeys.get(String(kid || '')) || null;
}

/**
 * The public half of every key a door may meet, as JWKs (RFC 7517) — what
 * GET /scan/keys serves. Nothing secret: x and y are a point on the curve.
 */
function jwks(env) {
  return [...keys(env).publicKeys.entries()].map(([kid, key]) => {
    const { x, y } = key.export({ format: 'jwk' });
    return { kid, kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', x, y };
  });
}

/**
 * A v2 code for these claims, or null when no key is configured. No `iat` and
 * no header `typ`: every byte makes the printed code denser and harder to read
 * off a cracked screen. The signature is the JOSE raw r||s (64 bytes), which
 * is what devices verify (mobile/src/gate/qrVerify.ts).
 */
function sign(claims, env) {
  const key = signingKey(env);
  if (!key) return null;
  return jwt.sign(claims, key.privateKey, {
    algorithm: 'ES256', keyid: key.kid, noTimestamp: true, header: { typ: undefined },
  });
}

/** Throws a readable error if the configuration is wrong. app.js calls it at boot. */
function assertConfig(env = process.env) {
  load(env);
}

module.exports = { signingKey, publicKey, jwks, sign, assertConfig };
