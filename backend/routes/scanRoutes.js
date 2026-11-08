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
  name: 'gate-login',
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

// ─── The check-in app's door reads ─────────────────────────────────────────
// Device-authenticated like the scan routes, under the same per-device budget.
// What each may return is decided in services/doorService.js from the device's
// role and the organizer's door settings, never from the request.
const door = require('../controllers/doorController');
const { query, param } = require('express-validator');

// The guest list is the one read worth scraping, so it gets its own, tighter
// budget on top of the device's: a search per second is far above any door.
const searchLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  name: 'gate-search',
  keyGenerator: (req) => `device:${req.device.deviceId}`,
  message: 'Searching faster than a door needs to. Wait a moment and try again.',
});

router.get('/me', requireDevice, gateLimiter, door.me);

router.get(
  '/recent',
  requireDevice,
  gateLimiter,
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isISO8601(),
  query('kind').optional().isIn(['admitted', 'all']),
  validate,
  door.recent,
);

router.get(
  '/attendees',
  requireDevice,
  gateLimiter,
  searchLimiter,
  query('q').optional().isString().isLength({ max: 100 }),
  query('status').optional().isIn(['all', 'in', 'out']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0, max: 100000 }),
  validate,
  door.attendees,
);

router.get(
  '/tickets/:ticketId',
  requireDevice,
  gateLimiter,
  param('ticketId').isUUID(),
  validate,
  door.ticket,
);

router.post(
  '/manual-check-in',
  requireDevice,
  gateLimiter,
  body('ticketId').isUUID(),
  body('clientScanId').optional().isString().isLength({ max: 100 }),
  validate,
  door.manualCheckIn,
);

router.get(
  '/analytics',
  requireDevice,
  gateLimiter,
  query('bucket').optional().isInt({ min: 5, max: 120 }),
  validate,
  door.analytics,
);

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

router.get(
  '/assignments',
  requireAuth,
  query('scope').optional().isIn(['all', 'scannable']),
  validate,
  staff.assignments,
);

router.post(
  '/staff-login',
  staffLoginLimiter,
  requireAuth,
  body('eventId').isUUID().withMessage('Choose the event you are scanning.'),
  validate,
  staff.staffLogin,
);

module.exports = router;
