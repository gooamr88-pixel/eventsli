const crypto = require('node:crypto');
const { promisify } = require('node:util');

const pbkdf2 = promisify(crypto.pbkdf2);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Password hashing — PBKDF2-HMAC-SHA512.
 *
 * Chosen over bcrypt/argon2 because it is in Node's standard library: no native
 * build step, nothing to break on a VPS upgrade, and one fewer dependency in the
 * path of every login. It is a slower-per-dollar defence than argon2id, which is
 * the honest trade being made here; the iteration count below is set to OWASP's
 * 2023 guidance for SHA-512 to compensate, and `password_algo` is stored per row
 * so it can be raised later without forcing anyone to reset.
 *
 * pbkdf2 (the async form) runs on the libuv threadpool. server.js sizes that
 * pool to 16 — with the default of 4, five people logging in at once queue
 * behind each other, and a login storm after a popular event goes on sale
 * becomes a stall rather than a slowdown.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ITERATIONS = 210_000;   // OWASP 2023 for PBKDF2-HMAC-SHA512
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const SALT_BYTES = 16;

/** `pbkdf2$<iterations>$<salt-b64>$<hash-b64>` — self-describing, so the cost can change. */
async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await pbkdf2(plain, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns `{ ok, needsRehash }`. `needsRehash` is true when the stored hash used
 * a lower iteration count than we now require — the caller re-hashes on the next
 * successful login, which upgrades the whole user base gradually and silently
 * instead of via a mass password reset nobody completes.
 */
async function verifyPassword(plain, stored) {
  // An account with no password (OAuth-only) must never authenticate by this
  // path. Returning false rather than throwing keeps the failure indistinct
  // from a wrong password, which is what an attacker probing for OAuth accounts
  // would otherwise learn.
  if (typeof stored !== 'string' || !stored.startsWith('pbkdf2$')) {
    return { ok: false, needsRehash: false };
  }

  const [, iterStr, saltB64, hashB64] = stored.split('$');
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || !saltB64 || !hashB64) {
    return { ok: false, needsRehash: false };
  }

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await pbkdf2(plain, salt, iterations, expected.length, DIGEST);

  // timingSafeEqual throws on a length mismatch, which would itself leak that
  // the stored hash has an unusual length.
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return { ok, needsRehash: ok && iterations < ITERATIONS };
}

/**
 * Hash a client IP before storing it.
 *
 * We keep IPs to spot credential stuffing and to show a user where their
 * sessions are, not to identify people. Hashing with a server-side salt means a
 * database copy does not hand over a list of who connected from where, and
 * rotating IP_HASH_SALT anonymises every historical row at once.
 */
function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error('IP_HASH_SALT is required to hash client addresses');
  return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 32);
}

/** URL-safe random token — password resets, invitations, table access grants. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 of a token, for storage.
 *
 * A reset token is a bearer credential: whoever holds it can take the account.
 * Storing only its digest means a leaked database cannot be used to reset
 * anyone's password. No salt and no stretching are needed — unlike a password,
 * the input already has 256 bits of entropy, so there is nothing to guess.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time string compare for secrets that are not hashes (webhook headers). */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashPassword,
  verifyPassword,
  hashIp,
  randomToken,
  hashToken,
  safeEqual,
  PBKDF2_ITERATIONS: ITERATIONS,
};
