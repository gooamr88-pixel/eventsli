const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/organizerController');

const router = express.Router();

// No requireRole here: creating the organizer profile is what GRANTS the
// organizer role, so gating it on already having that role would make it
// unreachable.
router.post(
  '/',
  requireAuth,
  body('displayName').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Enter the name people will see on your events.'),
  body('country').isString().trim().isLength({ min: 2, max: 2 })
    .withMessage('Country must be a two-letter code, e.g. CA or US.'),
  validate,
  c.create,
);

router.get('/me', requireAuth, c.me);

router.patch(
  '/',
  requireAuth,
  body('displayName').optional().isString().trim().isLength({ min: 2, max: 120 }),
  validate,
  c.update,
);

// ─── Stripe Connect ────────────────────────────────────────────────────────
// Without these an organizer has no way to attach a payout destination, and
// every checkout for them is refused with nothing in the product to fix it.
router.post('/stripe/onboard', requireAuth, c.startStripeOnboarding);
router.get('/stripe/status', requireAuth, c.stripeStatus);

module.exports = router;
