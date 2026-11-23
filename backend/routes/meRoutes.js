const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/meController');

/**
 * /api/v1/me — the signed-in person's saved events, notifications and push
 * devices (the attendee app, 2026-11-24). See controllers/meController.js.
 */
const router = express.Router();
router.use(requireAuth);

// ─── Saved events ──────────────────────────────────────────────────────────
router.get('/saved-events', c.savedEvents);
router.get('/saved-events/ids', c.savedEventIds);
router.put('/saved-events/:eventId', param('eventId').isUUID(), validate, c.saveEvent);
router.delete('/saved-events/:eventId', param('eventId').isUUID(), validate, c.unsaveEvent);

// ─── Notifications ─────────────────────────────────────────────────────────
router.get('/notifications', c.notifications);
router.post(
  '/notifications/read',
  // Exactly one of the two. `all` must be a real JSON true, the way the
  // checkout's acceptTerms is: a string "true" is not a decision.
  body().custom((value) => {
    const all = value?.all === true;
    const ids = Array.isArray(value?.ids) && value.ids.length > 0;
    if (all === ids) throw new Error('Send the notifications to mark, or all: true.');
    return true;
  }),
  body('ids').optional().isArray({ min: 1, max: 100 }),
  body('ids.*').optional().isUUID(),
  validate,
  c.markRead,
);

// ─── Push devices ──────────────────────────────────────────────────────────
// The same shape the database CHECK holds (push_devices.token), so a bad
// token is a 400 with words here rather than a constraint error there.
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

router.post(
  '/push-devices',
  body('token').isString().matches(EXPO_TOKEN).withMessage('That is not a push token.'),
  body('platform').isIn(['ios', 'android']).withMessage('Unknown platform.'),
  validate,
  c.registerDevice,
);
router.delete(
  '/push-devices',
  body('token').isString().matches(EXPO_TOKEN).withMessage('That is not a push token.'),
  validate,
  c.removeDevice,
);

module.exports = router;
module.exports.EXPO_TOKEN = EXPO_TOKEN;
