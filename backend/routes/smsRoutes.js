const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimit');
const sms = require('../controllers/smsWebhookController');

/**
 * /api/v1/sms — the public half of SMS.
 *
 *   /webhooks/:provider/status   delivery receipts (GET or POST: Vonage can send either)
 *   /webhooks/:provider/inbound  replies, including STOP / START / HELP
 *   /unsubscribe                 the opt-out link in marketing texts
 *   /preferences                 a signed-in person's own marketing consent
 *
 * The webhooks authenticate themselves (see the controller) and are exempt
 * from the global per-IP budget in app.js: providers call from shared ranges
 * and a busy campaign produces a receipt per message.
 */
const router = express.Router();
const PROVIDER = param('provider').isString().matches(/^[a-z][a-z0-9_]{1,31}$/);

router.all('/webhooks/:provider/status', PROVIDER, validate, sms.status);
router.all('/webhooks/:provider/inbound', PROVIDER, validate, sms.inbound);

const publicLimit = makeLimiter({ name: 'sms-public', windowMs: 15 * 60_000, max: 30 });

router.post('/unsubscribe', publicLimit, body('token').isString().isLength({ min: 20, max: 60 }), validate, sms.unsubscribe);

router.get('/preferences', requireAuth, sms.getPreferences);
router.put(
  '/preferences',
  requireAuth,
  publicLimit,
  body('phone').isString().trim().isLength({ min: 6, max: 30 }),
  body('transactional').optional().isBoolean({ strict: true }),
  body('marketing').optional().isBoolean({ strict: true }),
  body('organizers').optional().isArray({ max: 200 }),
  body('organizers.*.organizerId').optional().isUUID(),
  body('organizers.*.marketing').optional().isBoolean({ strict: true }),
  validate,
  sms.putPreferences,
);

module.exports = router;
