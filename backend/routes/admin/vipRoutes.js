const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const c = require('../../controllers/vipController');

/**
 * VIP Services — the console (2026-11-28), under the admin guard in
 * routes/admin/index.js. Mount it only there.
 *
 * Every admin runs requests and the WhatsApp inbox. The settings (the number
 * and email organizers see, the services offered, who is emailed) are a
 * super admin's, like the demo page's: they change what organizers see.
 */
const router = express.Router();

const STATUSES = ['new', 'in_review', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled'];
const e164 = () => body('contact').isString().matches(/^\+[1-9][0-9]{6,14}$/).withMessage('That number is not valid.');

router.get('/vip/settings', c.adminSettings);
router.put(
  '/vip/settings',
  requireRole('super_admin'),
  body('settings').isObject().withMessage('Send the settings.'),
  validate,
  c.adminSaveSettings,
);
router.get('/vip/connection', requireRole('super_admin'), c.adminConnection);
router.get('/vip/hosts', c.adminHosts);

router.get(
  '/vip/requests',
  query('view').optional().isIn(['open', 'new', 'closed', 'all']),
  query('q').optional().isString().isLength({ max: 80 }),
  query('page').optional().isInt({ min: 1, max: 1000 }),
  validate,
  c.adminList,
);
router.get('/vip/requests/:id', param('id').isUUID(), validate, c.adminGet);
router.patch(
  '/vip/requests/:id',
  param('id').isUUID(),
  body('status').optional().isIn(STATUSES),
  body('assignedTo').optional({ values: 'null' }).isUUID(),
  body('teamNotes').optional({ values: 'null' }).isString().isLength({ max: 8000 }),
  body('note').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('notify').optional().isBoolean({ strict: true }),
  validate,
  c.adminUpdate,
);
router.post(
  '/vip/requests/:id/reply',
  param('id').isUUID(),
  body('text').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Write a message.'),
  validate,
  c.adminReply,
);

router.get('/vip/whatsapp/unmatched', c.adminUnmatched);
router.post('/vip/whatsapp/link', e164(), body('requestId').isUUID(), body('adopt').optional().isBoolean({ strict: true }), validate, c.adminLink);
router.post(
  '/vip/whatsapp/reply',
  e164(),
  body('text').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Write a message.'),
  validate,
  c.adminReplyContact,
);
router.post('/vip/whatsapp/dismiss', e164(), validate, c.adminDismiss);
router.get('/vip/media/:messageId', param('messageId').isUUID(), validate, c.adminMedia);

module.exports = router;
