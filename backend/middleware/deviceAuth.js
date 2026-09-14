const scanSvc = require('../services/scanService');
const { sendFail } = require('../utils/responseEnvelope');

/**
 * Authenticates a SCANNER, not a person.
 *
 * Door staff share a tablet and change between shifts. Requiring a personal
 * login means either everyone knows the organizer's password or nobody can
 * scan; a device is its own principal, so a lost tablet is revoked on its own
 * without touching an account.
 */
async function requireDevice(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return sendFail(res, {
      status: 401, error: 'UNAUTHENTICATED',
      message: 'This scanner is not signed in.',
    });
  }

  const claims = scanSvc.verifyDeviceToken(token);
  if (!claims) {
    return sendFail(res, {
      status: 401, error: 'INVALID_TOKEN',
      message: 'This scanner needs to sign in again.',
    });
  }

  /**
   * REVOCATION HAS TO BITE NOW, NOT AT THE NEXT SIGN-IN.
   *
   * The signature check above is enough to prove the token was issued by us and
   * has not expired. It says nothing about whether the tablet is still ours.
   * Without the line below, "revoke the device" only stopped the next LOGIN —
   * and a device token lasts seven days, so a tablet left in a taxi went on
   * admitting people for a week after the organizer had switched it off and
   * watched the dashboard say `inactive`.
   *
   * That is the one action an organizer takes when a scanner goes missing, and
   * it is the whole reason a device is a separate principal in the first place.
   * A revocation that does not revoke is worse than no button at all: it is a
   * false assurance, acted on and then not thought about again.
   *
   * The cost is one primary-key lookup per scan. This is the same trade
   * requireAuth already makes for user sessions — every request re-checks the
   * session row — for the same reason, and a gate at full tilt is a few scans a
   * second, not a few thousand.
   *
   * `getActiveDevice` returns null on a database error as well as on a revoked
   * device, and that direction is deliberate: this runs on Express 4, where a
   * rejected promise from middleware is an unhandled rejection rather than a
   * 500, and the failure mode of a scanner that cannot reach the database must
   * be a closed door rather than an open one.
   */
  const device = await scanSvc.getActiveDevice(claims.deviceId, { staffUserId: claims.staffUserId });
  if (!device) {
    return sendFail(res, {
      status: 401, error: 'SESSION_REVOKED',
      message: claims.staffUserId
        ? 'You are no longer on the door team for this event.'
        : 'This device has been switched off by the organizer.',
    });
  }

  // The event comes from the TOKEN, never from the request body. Taking it from
  // the body would let one venue's tablet scan another venue's tickets by
  // changing one field.
  //
  // It is re-read from the ROW here rather than trusted from the claim, so a
  // device moved between events cannot keep scanning the old one on an old
  // token. They agree in every normal case; when they do not, the database is
  // the one that is current.
  // `staffUserId` is set when a named door-team member is scanning, and null
  // for a shared tablet. Either way the permissions are the same and narrow:
  // scan, undo and gate status, for this one event.
  req.device = { deviceId: device.id, eventId: device.eventId, staffUserId: device.staffUserId };
  return next();
}

module.exports = { requireDevice };
