const express = require('express');
const { makeLimiter } = require('../middleware/rateLimit');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireDevice } = require('../middleware/deviceAuth');
const c = require('../controllers/scanController');

const router = express.Router();

// A device PIN is short by necessity — door staff type it on a tablet between
// guests. Without a tight limit it is brute-forceable in minutes, and the
// attempt touches no user account so nothing else would notice.
const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  keyGenerator: (req) => `${req.ip}|${req.body?.deviceId || ''}`,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

router.post(
  '/login',
  loginLimiter,
  body('deviceId').isUUID().withMessage('Enter the device id.'),
  body('pin').isString().isLength({ min: 4, max: 32 }).withMessage('Enter the PIN.'),
  validate,
  c.deviceLogin,
);

/**
 * The door's limit is PER DEVICE, not per IP.
 *
 * These routes used to rely on the site-wide ceiling of 1,000 requests per
 * 15 minutes per IP. Every tablet at a venue shares one public address, so a
 * busy entrance — scans plus status polls from several doors — hit a 429 in
 * the middle of the queue. They are now exempt from that ceiling
 * (utils/gateRoutes.js) and limited here instead, AFTER the device is
 * authenticated, so the key is the device itself.
 *
 * 600 a minute is ten a second from one tablet: far above any human queue,
 * low enough that a stolen token cannot be used to hammer the database. An
 * offline backlog is one `/sync` request of up to 500 scans, not 500 requests.
 */
const gateLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 600,
  name: 'gate-device',
  keyGenerator: (req) => `device:${req.device.deviceId}`,
  message: 'This scanner is sending requests faster than a door can scan. Wait a moment and try again.',
});

router.post(
  '/verify',
  requireDevice,
  gateLimiter,
  body('qr').isString().isLength({ min: 10, max: 4000 }),
  body('clientScanId').optional().isString().isLength({ max: 100 }),
  body('occurredAt').optional().isISO8601(),
  validate,
  c.verify,
);

router.post(
  '/sync',
  requireDevice,
  gateLimiter,
  body('scans').isArray({ max: 500 }).withMessage('Send the queued scans.'),
  validate,
  c.sync,
);

router.post(
  '/undo',
  requireDevice,
  gateLimiter,
  body('ticketId').isUUID(),
  validate,
  c.undo,
);

router.get('/status', requireDevice, gateLimiter, c.status);

// ─── The door team: a person, with their own account ───────────────────────
// Alongside PIN devices, not instead of them. A session cookie proves who they
// are; membership of the event's door team decides whether they may scan it,
// and the token they get back is scoped to that one event.
const { requireAuth } = require('../middleware/auth');
const staff = require('../controllers/staffController');

const staffLoginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  name: 'staff-scan-login',
  message: 'Too many attempts. Wait a few minutes and try again.',
});

router.get('/assignments', requireAuth, staff.assignments);

router.post(
  '/staff-login',
  staffLoginLimiter,
  requireAuth,
  body('eventId').isUUID().withMessage('Choose the event you are scanning.'),
  validate,
  staff.staffLogin,
);

module.exports = router;
