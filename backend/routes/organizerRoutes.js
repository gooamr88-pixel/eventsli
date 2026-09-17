const express = require('express');
const { body, query, param } = require('express-validator');
const { sendFail } = require('../utils/responseEnvelope');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireActiveOrganizer } = require('../middleware/auth');
const c = require('../controllers/organizerController');
const stats = require('../controllers/statsController');
const { SUPPORTED_COUNTRIES } = require('../utils/markets');

const router = express.Router();

// No requireRole here: creating the organizer profile is what GRANTS the
// organizer role, so gating it on already having that role would make it
// unreachable.
// Organization setup — the step before the first event. Factories, not shared
// chains: a validator chain is mutable, and `.optional()` on a shared one would
// quietly make the field optional on POST as well.
const legalNameRule = () => body('legalName').isString().trim().isLength({ min: 2, max: 160 })
  .withMessage('Enter the name of your organization.');
const descriptionRule = () => body('description').isString().trim().isLength({ min: 20, max: 2000 })
  .withMessage('Describe your organization in a sentence or two (at least 20 characters).');

router.post(
  '/',
  requireAuth,
  body('displayName').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Enter the brand name people will see on your events.'),
  legalNameRule(),
  descriptionRule(),
  // `=== true`: the string "false" is truthy.
  body('acceptPolicies').custom((v) => v === true)
    .withMessage('Agree to the organizer agreement to continue.'),
  // Only the markets Eventsli sells in (BRD §07). Any two letters used to be
  // accepted and became the country of the organizer's Stripe account, which
  // cannot be changed afterwards.
  body('country').isString().trim().toUpperCase().isIn(SUPPORTED_COUNTRIES)
    .withMessage('Eventsli is open to organizers in Canada (CA) and the United States (US).'),
  validate,
  c.create,
);

router.get('/me', requireAuth, c.me);
router.get('/setup-defaults', requireAuth, c.setupDefaults);

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
  legalNameRule().optional(),
  descriptionRule().optional(),
  body('acceptPolicies').optional().isBoolean(),
  validate,
  c.update,
);

// ─── Stripe Connect ────────────────────────────────────────────────────────
// Without these an organizer has no way to attach a payout destination, and
// every checkout for them is refused with nothing in the product to fix it.
router.post('/stripe/onboard', requireAuth, requireActiveOrganizer, c.startStripeOnboarding);
router.get('/stripe/status', requireAuth, c.stripeStatus);

// ─── Manual payment methods ────────────────────────────────────────────────
// An admin without an organizer profile passes requireRole; the handlers scope
// every query by organizer id, so there must be one.
function requireOrganizerProfile(req, res, next) {
  if (req.user?.access?.organizerId) return next();
  return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'Create your organizer profile first.' });
}

const methodRules = (optional) => {
  const maybe = (chain) => (optional ? chain.optional() : chain);
  return [
    maybe(body('kind')).isIn(['e_transfer', 'bank_transfer', 'cash', 'other'])
      .withMessage('Choose the kind of payment.'),
    maybe(body('label')).isString().trim().isLength({ min: 2, max: 80 })
      .withMessage('Give it a short name buyers recognise, e.g. "Interac e-Transfer".'),
    maybe(body('instructions')).isString().trim().isLength({ min: 5, max: 1000 })
      .withMessage('Tell buyers how to pay, e.g. "Send to pay@yourorg.com with your order number".'),
  ];
};

const methods = [requireAuth, requireRole('organizer'), requireOrganizerProfile, requireActiveOrganizer];

router.get('/payment-methods', ...methods, c.listPaymentMethods);
router.post('/payment-methods', ...methods, ...methodRules(false), validate, c.createPaymentMethod);
router.patch(
  '/payment-methods/:methodId',
  ...methods,
  param('methodId').isUUID(),
  ...methodRules(true),
  body('isActive').optional().isBoolean(),
  validate,
  c.updatePaymentMethod,
);
router.delete('/payment-methods/:methodId', ...methods, param('methodId').isUUID(), validate, c.deletePaymentMethod);

module.exports = router;
