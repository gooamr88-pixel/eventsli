const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time email codes: made, cleaned up and hashed here. Pure, so the rules are
 * testable with no database.
 *
 * WHY AN HMAC AND NOT A PLAIN HASH. A reset token carries 256 bits and a plain
 * SHA-256 of it is safe to store (see utils/crypto.hashToken). A six-digit code
 * carries twenty bits: with a leaked table, hashing all million candidates takes
 * well under a second. Keyed with a server secret, the stored value is useless
 * without that secret too. The user id is in the message, so the same code for
 * two accounts never produces the same stored value.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/** Uniformly random, zero-padded — `randomInt`, never `Math.random`. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * What a person typed, as six digits — or null.
 *
 * Spaces and dashes are forgiven because people copy "123 456" out of an email
 * client that grouped it; anything else is not a code.
 */
function normaliseCode(input) {
  const digits = String(input ?? '').replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

function hashCode({ userId, code, secret = process.env.JWT_SECRET }) {
  if (!secret) throw new Error('JWT_SECRET is required to hash verification codes');
  if (!userId || !code) throw new Error('hashCode needs a user id and a code');
  return crypto
    .createHmac('sha256', secret)
    .update(`email-verification:${userId}:${code}`)
    .digest('hex');
}

module.exports = {
  CODE_LENGTH, TTL_MINUTES, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS,
  generateCode, normaliseCode, hashCode,
};
