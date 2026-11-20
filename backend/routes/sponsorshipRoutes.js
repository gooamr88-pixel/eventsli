const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { makeLimiter } = require('../middleware/rateLimit');
const {
  requireAuth, requireRole, requireActiveOrganizer, verifyEventOwner,
} = require('../middleware/auth');
const { EXTENSION_FOR } = require('../services/mediaService');
const { LEVELS, OFFLINE_METHODS, MAX_INSTALLMENTS } = require('../services/sponsorshipRules');
const c = require('../controllers/sponsorshipController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sponsorships (2026-11-20) — three routers, three audiences:
 *
 *   organizer    /api/v1/events/:eventId/sponsorship/…   the event's owner
 *   partner      /api/v1/partner/sponsorships/…          the sponsor, signed in
 *   publicRouter /api/v1/public/events/:slug/sponsorship anyone
 *
 * Each is mounted at its own prefix in app.js (mergeParams for the event id
 * and slug), so its middleware runs only for its own paths.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const uuid = (name) => param(name).isUUID().withMessage('Not found.');
const http = (field) => body(field).optional({ values: 'falsy' }).isString().trim()
  .isLength({ max: 2000 }).matches(/^https?:\/\/\S+$/i).withMessage('Enter a full web address starting with https://');

// ═══ Organizer ═════════════════════════════════════════════════════════════
const organizer = express.Router({ mergeParams: true });
organizer.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);


organizer.get('/program', uuid('eventId'), validate, verifyEventOwner, c.organizer.getProgram);
organizer.put(
  '/program',
  uuid('eventId'), validate, verifyEventOwner,
  body('isOpen').optional().isBoolean({ strict: true }),
  body('headline').optional({ values: 'null' }).isString().trim().isLength({ max: 120 })
    .withMessage('The headline is at most 120 characters.'),
  body('intro').optional({ values: 'null' }).isString().trim().isLength({ max: 3000 })
    .withMessage('The introduction is at most 3000 characters.'),
  body('contactEmail').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address.'),
  body('defaultTerms').optional({ values: 'null' }).isString().isLength({ max: 20000 })
    .withMessage('The agreement is at most 20,000 characters.'),
  body('paymentInstructions').optional({ values: 'null' }).isString().isLength({ max: 2000 })
    .withMessage('Payment instructions are at most 2000 characters.'),
  validate,
  c.organizer.saveProgram,
);

const packageRules = (partial) => [
  body('name')[partial ? 'optional' : 'exists']().isString().trim().isLength({ min: 1, max: 80 })
    .withMessage('Name the package, e.g. Gold sponsor.'),
  body('level').optional().isIn(LEVELS).withMessage('Choose a tier.'),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 600 })
    .withMessage('A description is at most 600 characters.'),
  body('priceCents')[partial ? 'optional' : 'exists']().isInt({ min: 0, max: 10_000_000_000 })
    .withMessage('The price must be a whole number of cents.'),
  body('quantity').optional({ values: 'null' }).isInt({ min: 1, max: 1000 })
    .withMessage('How many sponsors can take it: a whole number, or leave it empty for no limit.'),
  body('benefits').optional().isArray({ max: 30 }).withMessage('At most 30 benefits.'),
  body('isPublic').optional().isBoolean({ strict: true }),
  body('isActive').optional().isBoolean({ strict: true }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
];
organizer.get('/packages', uuid('eventId'), validate, verifyEventOwner, c.organizer.listPackages);
organizer.post('/packages', uuid('eventId'), validate, verifyEventOwner, ...packageRules(false), validate, c.organizer.createPackage);
organizer.patch('/packages/:packageId', uuid('eventId'), uuid('packageId'), validate, verifyEventOwner, ...packageRules(true), validate, c.organizer.updatePackage);
organizer.delete('/packages/:packageId', uuid('eventId'), uuid('packageId'), validate, verifyEventOwner, c.organizer.removePackage);

const contactRules = (partial) => [
  body('companyName')[partial ? 'optional' : 'exists']().isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('Enter the company name.'),
  body('contactEmail')[partial ? 'optional' : 'exists']().isEmail().withMessage('Enter the contact’s email address.'),
  body('contactName').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body('contactPhone').optional({ values: 'null' }).isString().trim().isLength({ max: 30 }),
  http('website'),
];

organizer.get('/deals', uuid('eventId'), validate, verifyEventOwner, c.organizer.listDeals);
organizer.post(
  '/deals',
  uuid('eventId'), validate, verifyEventOwner,
  ...contactRules(false),
  body('packageId').optional({ values: 'falsy' }).isUUID(),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  validate,
  c.organizer.createDeal,
);
// Logo upload for a deal: registered before `:dealId` routes.
organizer.post(
  '/logo-upload',
  uuid('eventId'), validate, verifyEventOwner,
  body('contentType').isIn(Object.keys(EXTENSION_FOR)).withMessage('Upload a JPEG, PNG or WebP image.'),
  validate,
  c.organizer.signLogoUpload,
);
organizer.post(
  '/logo',
  uuid('eventId'), validate, verifyEventOwner,
  body('path').isString().trim().isLength({ min: 1, max: 300 }),
  validate,
  c.organizer.confirmLogo,
);
organizer.get('/deals/:dealId', uuid('eventId'), uuid('dealId'), validate, verifyEventOwner, c.organizer.getDeal);
organizer.patch(
  '/deals/:dealId',
  uuid('eventId'), uuid('dealId'), validate, verifyEventOwner,
  ...contactRules(true),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  body('displayName').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  http('linkUrl'),
  body('logoPath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.organizer.updateDeal,
);
organizer.post(
  '/deals/:dealId/proposal',
  uuid('eventId'), uuid('dealId'), validate, verifyEventOwner,
  body('packageId').optional({ values: 'falsy' }).isUUID(),
  body('level').optional().isIn(LEVELS),
  body('amountCents').isInt({ min: 0, max: 10_000_000_000 }).withMessage('Enter the sponsorship amount.'),
  body('benefits').optional().isArray({ max: 30 }),
  body('terms').isString().trim().isLength({ min: 1, max: 20000 }).withMessage('Write the agreement the sponsor will sign.'),
  body('expiresAt').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid reply-by date.'),
  body('installments').optional().isArray({ max: MAX_INSTALLMENTS }),
  validate,
  c.organizer.sendProposal,
);
organizer.post(
  '/deals/:dealId/installments/:installmentId/paid',
  uuid('eventId'), uuid('dealId'), uuid('installmentId'), validate, verifyEventOwner,
  body('method').isIn(OFFLINE_METHODS).withMessage('Choose how the payment was made.'),
  body('reference').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  validate,
  c.organizer.recordPayment,
);
organizer.post(
  '/deals/:dealId/close',
  uuid('eventId'), uuid('dealId'), validate, verifyEventOwner,
  body('outcome').isIn(['lost', 'cancelled']),
  body('reason').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
  validate,
  c.organizer.close,
);
organizer.post('/deals/:dealId/reopen', uuid('eventId'), uuid('dealId'), validate, verifyEventOwner, c.organizer.reopen);

// ═══ Sponsor portal ════════════════════════════════════════════════════════
// Any signed-in account: a sponsor is usually not an organizer.
const partner = express.Router();
partner.use(requireAuth);

partner.get('/', c.partner.list);
partner.get('/:dealId', uuid('dealId'), validate, c.partner.get);
partner.post(
  '/:dealId/sign',
  makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'sponsorship-sign', message: 'Too many attempts. Please wait a few minutes.' }),
  uuid('dealId'),
  body('signerName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter your full name as the person signing.'),
  body('accept').isBoolean({ strict: true }),
  validate,
  c.partner.sign,
);
partner.patch(
  '/:dealId/brand',
  uuid('dealId'),
  body('displayName').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  http('linkUrl'),
  body('logoPath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.partner.updateBrand,
);
partner.post(
  '/:dealId/logo-upload',
  uuid('dealId'),
  body('contentType').isIn(Object.keys(EXTENSION_FOR)).withMessage('Upload a JPEG, PNG or WebP image.'),
  validate,
  c.partner.signLogoUpload,
);
partner.post(
  '/:dealId/logo',
  uuid('dealId'),
  body('path').isString().trim().isLength({ min: 1, max: 300 }),
  validate,
  c.partner.confirmLogo,
);
partner.post(
  '/:dealId/installments/:installmentId/pay',
  makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'sponsorship-pay', message: 'Too many attempts. Please wait a few minutes.' }),
  uuid('dealId'), uuid('installmentId'), validate,
  c.partner.pay,
);

// ═══ Public ════════════════════════════════════════════════════════════════
const publicRouter = express.Router({ mergeParams: true });
publicRouter.get('/', param('slug').isString().isLength({ min: 1, max: 200 }), validate, c.publicPage.page);
publicRouter.post(
  '/inquiries',
  makeLimiter({ windowMs: 60 * 60 * 1000, max: 5, name: 'sponsor-inquiry', message: 'You have sent several inquiries. Please wait a while before sending another.' }),
  param('slug').isString().isLength({ min: 1, max: 200 }),
  body('companyName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter your company name.'),
  body('contactName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter your name.'),
  body('contactEmail').isEmail().withMessage('Enter a valid email address.'),
  body('contactPhone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 30 }),
  http('website'),
  body('message').optional({ values: 'falsy' }).isString().trim().isLength({ max: 2000 })
    .withMessage('A message is at most 2000 characters.'),
  body('packageId').optional({ values: 'falsy' }).isUUID(),
  validate,
  c.publicPage.inquire,
);

module.exports = { organizer, partner, publicRouter };
