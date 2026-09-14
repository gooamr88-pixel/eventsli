const jwt = require('jsonwebtoken');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The two credentials a gate can hold, signed and read in ONE place.
 *
 *   scan_device  a shared tablet, signed in with its id and PIN. Seven days.
 *   scan_staff   a named person on the event's door team, signed in with their
 *                own account. Sixteen hours — a shift, not a weekend: a person's
 *                credential outliving the night they worked is a door key in a
 *                coat pocket.
 *
 * Both carry the EVENT, and the middleware never takes it from anywhere else.
 * The `typ` claim is what stops a session cookie — signed with the same secret —
 * from being replayed as either.
 *
 * Pure: no database, no Supabase client, so the claim rules are testable with
 * nothing but a secret (see test/pureModules.test.js for why that is enforced).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEVICE_TOKEN_TYPE = 'scan_device';
const STAFF_TOKEN_TYPE = 'scan_staff';
const DEVICE_TOKEN_DAYS = 7;
const STAFF_TOKEN_HOURS = 16;

function signDeviceToken({ deviceId, eventId }, secret = process.env.JWT_SECRET) {
  return jwt.sign(
    { typ: DEVICE_TOKEN_TYPE, did: deviceId, eid: eventId },
    secret,
    { algorithm: 'HS256', expiresIn: `${DEVICE_TOKEN_DAYS}d` },
  );
}

function signStaffToken({ deviceId, eventId, userId }, secret = process.env.JWT_SECRET) {
  return jwt.sign(
    { typ: STAFF_TOKEN_TYPE, did: deviceId, eid: eventId, uid: userId },
    secret,
    { algorithm: 'HS256', expiresIn: `${STAFF_TOKEN_HOURS}h` },
  );
}

/**
 * `{ deviceId, eventId, staffUserId }`, or null.
 *
 * `staffUserId` is null for a tablet and set for a person, and the middleware
 * checks the device row agrees — a PIN token cannot ride a staff device and a
 * staff token cannot ride a tablet.
 */
function verifyScanToken(token, secret = process.env.JWT_SECRET) {
  if (!token || !secret) return null;
  try {
    // Algorithm pinned: an `alg: none` token must not verify.
    const c = jwt.verify(String(token), secret, { algorithms: ['HS256'] });
    if (c.typ === DEVICE_TOKEN_TYPE && c.did && c.eid) {
      return { deviceId: c.did, eventId: c.eid, staffUserId: null };
    }
    if (c.typ === STAFF_TOKEN_TYPE && c.did && c.eid && c.uid) {
      return { deviceId: c.did, eventId: c.eid, staffUserId: c.uid };
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  DEVICE_TOKEN_TYPE, STAFF_TOKEN_TYPE, DEVICE_TOKEN_DAYS, STAFF_TOKEN_HOURS,
  signDeviceToken, signStaffToken, verifyScanToken,
};
