const express = require('express');
const { makeLimiter } = require('../middleware/rateLimit');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireDevice } = require('../middleware/deviceAuth');
const { sendFail } = require('../utils/responseEnvelope');
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

// Deliberately NOT rate limited beyond the global ceiling: a busy gate scans
// hundreds of people in a few minutes, and throttling the door is worse than
// anything it would prevent. Every request here is already authenticated by a
// device token.
router.post(
  '/verify',
  requireDevice,
  body('qr').isString().isLength({ min: 10, max: 4000 }),
  body('clientScanId').optional().isString().isLength({ max: 100 }),
  body('occurredAt').optional().isISO8601(),
  validate,
  c.verify,
);

router.post(
  '/sync',
  requireDevice,
  body('scans').isArray({ max: 500 }).withMessage('Send the queued scans.'),
  validate,
  c.sync,
);

router.post(
  '/undo',
  requireDevice,
  body('ticketId').isUUID(),
  validate,
  c.undo,
);

router.get('/status', requireDevice, c.status);

module.exports = router;
