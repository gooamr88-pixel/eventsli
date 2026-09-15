const express = require('express');
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireActiveOrganizer } = require('../middleware/auth');
const c = require('../controllers/organizerController');
const stats = require('../controllers/statsController');
const { SUPPORTED_COUNTRIES } = require('../utils/markets');

const router = express.Router();

// No requireRole here: creating the organizer profile is what GRANTS the
// organizer role, so gating it on already having that role would make it
// unreachable.
router.post(
  '/',
  requireAuth,
  body('displayName').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Enter the name people will see on your events.'),
  // Only the markets Eventsli sells in (BRD §07). Any two letters used to be
  // accepted and became the country of the organizer's Stripe account, which
  // cannot be changed afterwards.
  body('country').isString().trim().toUpperCase().isIn(SUPPORTED_COUNTRIES)
    .withMessage('Eventsli is open to organizers in Canada (CA) and the United States (US).'),
  validate,
  c.create,
);

router.get('/me', requireAuth, c.me);

// The dashboard home: every event's numbers in one round trip.
router.get(
  '/dashboard',
  requireAuth,
  requireRole('organizer'),
  query('days').optional().isIn(['7', '30', '90']),
  validate,
  stats.organizerDashboard,
);

// A banned organizer keeps READING their profile and payouts, but cannot
// rename themselves or start a payout account — the same line the event
// routes draw with requireActiveOrganizer.
router.patch(
  '/',
  requireAuth,
  requireActiveOrganizer,
  body('displayName').optional().isString().trim().isLength({ min: 2, max: 120 }),
  validate,
  c.update,
);

// ─── Stripe Connect ────────────────────────────────────────────────────────
// Without these an organizer has no way to attach a payout destination, and
// every checkout for them is refused with nothing in the product to fix it.
router.post('/stripe/onboard', requireAuth, requireActiveOrganizer, c.startStripeOnboarding);
router.get('/stripe/status', requireAuth, c.stripeStatus);

module.exports = router;
