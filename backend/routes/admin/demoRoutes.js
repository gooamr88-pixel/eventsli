const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const c = require('../../controllers/demoController');

/**
 * Book a demo — the console (2026-11-19), under the admin guard in
 * routes/admin/index.js. Mount it only there.
 *
 * Every admin runs the bookings (notes, status, cancel, move). Changing the
 * SETTINGS — the hours, the form, who is emailed — is a super admin's, like
 * the storefront and Eventsli's templates: it changes a public page.
 */
const router = express.Router();

router.get('/demo/settings', c.adminSettings);
router.put(
  '/demo/settings',
  requireRole('super_admin'),
  body('settings').isObject().withMessage('Send the settings.'),
  validate,
  c.adminSaveSettings,
);

router.get('/demo/hosts', c.adminHosts);
router.get(
  '/demo/bookings',
  query('view').optional().isIn(['upcoming', 'past', 'cancelled', 'all']),
  query('q').optional().isString().isLength({ max: 80 }),
  query('page').optional().isInt({ min: 1, max: 1000 }),
  validate,
  c.adminList,
);
router.get('/demo/bookings/:id', param('id').isUUID(), validate, c.adminGet);
router.patch(
  '/demo/bookings/:id',
  param('id').isUUID(),
  body('status').optional().isIn(['confirmed', 'completed', 'no_show']),
  body('hostNotes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  body('meetingLink').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('assignedTo').optional({ values: 'null' }).isUUID(),
  body('notify').optional().isBoolean({ strict: true }),
  validate,
  c.adminUpdate,
);
router.post(
  '/demo/bookings/:id/cancel',
  param('id').isUUID(),
  body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  body('notify').optional().isBoolean({ strict: true }),
  validate,
  c.adminCancel,
);
router.post(
  '/demo/bookings/:id/reschedule',
  param('id').isUUID(),
  body('startsAt').isISO8601().withMessage('Choose the new date and time.'),
  body('notify').optional().isBoolean({ strict: true }),
  validate,
  c.adminReschedule,
);

module.exports = router;
