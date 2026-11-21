const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { makeLimiter } = require('../middleware/rateLimit');
const {
  requireAuth, requireRole, requireActiveOrganizer, verifyEventOwner,
} = require('../middleware/auth');
const { EXTENSION_FOR } = require('../services/mediaService');
const { OFFLINE_METHODS, MAX_QUESTIONS, MAX_CATEGORIES } = require('../services/vendorRules');
const c = require('../controllers/vendorController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vendors (2026-11-20) — three routers, three audiences, each mounted at its
 * own prefix in app.js:
 *
 *   organizer    /api/v1/events/:eventId/vendors/…     the event's owner
 *   vendor       /api/v1/partner/vendors/…             the vendor, signed in
 *   publicRouter /api/v1/public/events/:slug/vendors   anyone
 * ─────────────────────────────────────────────────────────────────────────────
 */

const uuid = (name) => param(name).isUUID().withMessage('Not found.');
const http = (field) => body(field).optional({ values: 'falsy' }).isString().trim()
  .isLength({ max: 2000 }).matches(/^https?:\/\/\S+$/i).withMessage('Enter a full web address starting with https://');

// ═══ Organizer ═════════════════════════════════════════════════════════════
const organizer = express.Router({ mergeParams: true });
organizer.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);
const own = [uuid('eventId'), validate, verifyEventOwner];

organizer.get('/program', ...own, c.organizer.getProgram);
organizer.put(
  '/program',
  ...own,
  body('isOpen').optional().isBoolean({ strict: true }),
  body('headline').optional({ values: 'null' }).isString().isLength({ max: 120 }).withMessage('The headline is at most 120 characters.'),
  body('intro').optional({ values: 'null' }).isString().isLength({ max: 3000 }).withMessage('The introduction is at most 3000 characters.'),
  body('applicationsCloseAt').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid closing date.'),
  body('categories').optional().isArray({ max: MAX_CATEGORIES }),
  body('questions').optional().isArray({ max: MAX_QUESTIONS }).withMessage(`At most ${MAX_QUESTIONS} questions.`),
  body('contactEmail').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address.'),
  body('defaultTerms').optional({ values: 'null' }).isString().isLength({ max: 20000 }),
  body('paymentInstructions').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
  body('vendorInfo').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  // The booking flow (2026-11-21).
  body('bookingMode').optional().isIn(['apply', 'instant']).withMessage('Choose how vendors book.'),
  body('holdMinutes').optional().isInt({ min: 10, max: 60 }).withMessage('Hold a booth for 10 to 60 minutes.'),
  body('documents').optional().isArray({ max: 8 }).withMessage('Ask for at most 8 documents.'),
  body('highlights').optional().isArray({ max: 3 }).withMessage('At most 3 highlights.'),
  body('photos').optional().isArray({ max: 3 }).withMessage('Up to 3 photos.'),
  validate,
  c.organizer.saveProgram,
);

const boothRules = (partial) => [
  body('name')[partial ? 'optional' : 'exists']().isString().trim().isLength({ min: 1, max: 80 })
    .withMessage('Name the space, e.g. 10×10 stall.'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 600 }),
  body('sizeLabel').optional({ values: 'null' }).isString().isLength({ max: 40 }),
  body('priceCents')[partial ? 'optional' : 'exists']().isInt({ min: 0, max: 10_000_000_000 })
    .withMessage('The booth fee must be a whole number of cents.'),
  body('quantity').optional({ values: 'null' }).isInt({ min: 1, max: 5000 })
    .withMessage('How many: a whole number, or leave it empty for no limit.'),
  body('staffPasses').optional().isInt({ min: 0, max: 50 }).withMessage('Staff passes: 0 to 50.'),
  body('includes').optional().isArray({ max: 30 }),
  body('color').optional({ values: 'null' }).matches(/^#[0-9a-fA-F]{6}$/).withMessage('Choose a colour.'),
  body('isPublic').optional().isBoolean({ strict: true }),
  body('isActive').optional().isBoolean({ strict: true }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('imagePath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
];
organizer.get('/booths', ...own, c.organizer.listBooths);
organizer.post('/booths', ...own, ...boothRules(false), validate, c.organizer.createBooth);
organizer.patch('/booths/:boothId', uuid('boothId'), ...own, ...boothRules(true), validate, c.organizer.updateBooth);
organizer.delete('/booths/:boothId', uuid('boothId'), ...own, c.organizer.removeBooth);

// Add-ons (2026-11-21): booth extras and marketing, priced on top of the booth.
const addonRules = (partial) => [
  body('name')[partial ? 'optional' : 'exists']().isString().trim().isLength({ min: 1, max: 80 }).withMessage('Name the add-on, e.g. Extra chair.'),
  body('kind').optional().isIn(['booth', 'marketing']),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  body('priceCents')[partial ? 'optional' : 'exists']().isInt({ min: 0, max: 10_000_000_000 }).withMessage('The price must be a whole number of cents.'),
  body('isActive').optional().isBoolean({ strict: true }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
];
organizer.get('/addons', ...own, c.organizer.listAddons);
organizer.post('/addons', ...own, ...addonRules(false), validate, c.organizer.createAddon);
organizer.patch('/addons/:addonId', uuid('addonId'), ...own, ...addonRules(true), validate, c.organizer.updateAddon);
organizer.delete('/addons/:addonId', uuid('addonId'), ...own, c.organizer.removeAddon);

organizer.get('/door-list', ...own, c.organizer.doorList);
// The floor plan (2026-11-20): one JSON document, checked element by element
// in services/vendorFloorPlan.js; `version` guards against a stale tab.
organizer.get('/floor-plan', ...own, c.organizer.getFloorPlan);
organizer.put(
  '/floor-plan',
  ...own,
  body('plan').isObject().withMessage('Send the floor plan.'),
  body('version').isInt({ min: 0 }),
  validate,
  c.organizer.saveFloorPlan,
);
organizer.post('/logo-upload', ...own,
  body('contentType').isIn(Object.keys(EXTENSION_FOR)).withMessage('Upload a JPEG, PNG or WebP image.'), validate,
  c.organizer.signLogoUpload);
organizer.post('/logo', ...own, body('path').isString().isLength({ min: 1, max: 300 }), validate, c.organizer.confirmLogo);

organizer.get('/applications', ...own, c.organizer.list);
organizer.post(
  '/applications',
  ...own,
  body('businessName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter the business name.'),
  body('contactEmail').isEmail().withMessage('Enter the contact’s email address.'),
  body('contactName').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body('contactPhone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  http('website'),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 60 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  validate,
  c.organizer.create,
);
organizer.get('/applications/:appId', uuid('appId'), ...own, c.organizer.get);
organizer.patch(
  '/applications/:appId',
  uuid('appId'), ...own,
  body('businessName').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('contactEmail').optional().isEmail(),
  body('contactName').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body('contactPhone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  http('website'),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 60 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('boothLabel').optional({ values: 'null' }).isString().isLength({ max: 40 }),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  body('listed').optional().isBoolean({ strict: true }),
  body('logoPath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.organizer.update,
);
organizer.post('/applications/:appId/waitlist', uuid('appId'), ...own, body('waitlisted').optional().isBoolean({ strict: true }), validate, c.organizer.waitlist);
organizer.post(
  '/applications/:appId/offer',
  uuid('appId'), ...own,
  // A booth picked on the floor plan; its type is used when none is chosen.
  body('boothKey').optional({ values: 'falsy' }).isString().isLength({ max: 40 }),
  body('boothTypeId').optional({ values: 'falsy' }).isUUID().withMessage('Choose a booth type.'),
  body('amountCents').optional({ values: 'null' }).isInt({ min: 0, max: 10_000_000_000 }).withMessage('Enter the booth fee.'),
  body('boothLabel').optional({ values: 'null' }).isString().isLength({ max: 40 }),
  body('staffPasses').optional({ values: 'null' }).isInt({ min: 0, max: 50 }),
  body('includes').optional().isArray({ max: 30 }),
  body('terms').isString().trim().isLength({ min: 1, max: 20000 }).withMessage('Write the vendor terms they will sign.'),
  body('expiresAt').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid reply-by date.'),
  validate,
  c.organizer.offer,
);
organizer.post(
  '/applications/:appId/paid',
  uuid('appId'), ...own,
  body('method').isIn(OFFLINE_METHODS).withMessage('Choose how the payment was made.'),
  body('reference').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  validate,
  c.organizer.recordPayment,
);
// Documents a vendor uploaded (2026-11-21): a five-minute link, and a review.
const docId = () => param('docId').matches(/^[a-z0-9_-]{1,24}$/i).withMessage('Not found.');
organizer.get('/applications/:appId/documents/:docId', uuid('appId'), docId(), ...own, c.organizer.documentUrl);
organizer.post(
  '/applications/:appId/documents/:docId/review',
  uuid('appId'), docId(), ...own,
  body('status').isIn(['approved', 'rejected', 'pending']).withMessage('Approve or reject the document.'),
  body('note').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.organizer.reviewDocument,
);
organizer.post(
  '/applications/:appId/close',
  uuid('appId'), ...own,
  body('outcome').isIn(['rejected', 'cancelled']),
  body('reason').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  validate,
  c.organizer.close,
);

// ═══ Vendor portal ═════════════════════════════════════════════════════════
const vendor = express.Router();
vendor.use(requireAuth);
vendor.get('/', c.vendor.list);

// The booking flow (2026-11-21): start from a booth, fill the details, then
// send (apply) or sign and pay (instant). services/vendorBookingService.js.
const bookingLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 30, name: 'vendor-book', message: 'Too many attempts. Please wait a few minutes.' });
vendor.post(
  '/bookings',
  bookingLimiter,
  body('slug').isString().isLength({ min: 1, max: 200 }),
  body('boothTypeId').optional({ values: 'falsy' }).isUUID(),
  body('boothKey').optional({ values: 'falsy' }).isString().isLength({ max: 40 }),
  body('addonIds').optional().isArray({ max: 30 }),
  validate,
  c.booking.start,
);
vendor.get('/bookings/:appId', uuid('appId'), validate, c.booking.get);
vendor.patch(
  '/bookings/:appId',
  uuid('appId'),
  body('businessName').optional().isString().isLength({ max: 120 }),
  body('contactName').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body('contactPhone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  http('website'),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 60 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('address').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  body('city').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('postalCode').optional({ values: 'null' }).isString().isLength({ max: 20 }),
  body('socials').optional().isObject(),
  body('answers').optional().isObject(),
  body('logoPath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.booking.save,
);
const vDocId = () => param('docId').matches(/^[a-z0-9_-]{1,24}$/i).withMessage('Not found.');
vendor.post('/bookings/:appId/documents/:docId/upload', uuid('appId'), vDocId(),
  body('contentType').isIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']).withMessage('Upload a PDF, or a JPEG, PNG or WebP image.'),
  validate, c.booking.signDocument);
vendor.post('/bookings/:appId/documents/:docId', uuid('appId'), vDocId(),
  body('path').isString().isLength({ min: 1, max: 300 }), body('fileName').optional().isString().isLength({ max: 255 }),
  validate, c.booking.confirmDocument);
vendor.delete('/bookings/:appId/documents/:docId', uuid('appId'), vDocId(), validate, c.booking.removeDocument);
vendor.get('/bookings/:appId/documents/:docId', uuid('appId'), vDocId(), validate, c.booking.documentUrl);
vendor.post('/bookings/:appId/submit', bookingLimiter, uuid('appId'), validate, c.booking.submit);
vendor.post('/bookings/:appId/release', uuid('appId'), validate, c.booking.release);
vendor.post(
  '/bookings/:appId/checkout',
  makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'vendor-checkout', message: 'Too many attempts. Please wait a few minutes.' }),
  uuid('appId'),
  body('signerName').optional().isString().isLength({ max: 120 }),
  body('accept').optional().isBoolean({ strict: true }),
  body('method').optional().isIn(['card', 'offline']),
  validate,
  c.booking.checkout,
);
vendor.get('/:appId', uuid('appId'), validate, c.vendor.get);
vendor.post(
  '/:appId/accept',
  makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'vendor-accept', message: 'Too many attempts. Please wait a few minutes.' }),
  uuid('appId'),
  body('signerName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter your full name as the person signing.'),
  body('accept').isBoolean({ strict: true }),
  validate,
  c.vendor.accept,
);
vendor.post('/:appId/withdraw', uuid('appId'), body('reason').optional({ values: 'null' }).isString().isLength({ max: 500 }), validate, c.vendor.withdraw);
vendor.patch(
  '/:appId',
  uuid('appId'),
  body('staff').optional().isArray({ max: 50 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('listed').optional().isBoolean({ strict: true }),
  body('logoPath').optional({ values: 'null' }).isString().isLength({ max: 300 }),
  validate,
  c.vendor.update,
);
vendor.post('/:appId/logo-upload', uuid('appId'),
  body('contentType').isIn(Object.keys(EXTENSION_FOR)).withMessage('Upload a JPEG, PNG or WebP image.'), validate, c.vendor.signLogoUpload);
vendor.post('/:appId/logo', uuid('appId'), body('path').isString().isLength({ min: 1, max: 300 }), validate, c.vendor.confirmLogo);
vendor.post(
  '/:appId/pay',
  makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'vendor-pay', message: 'Too many attempts. Please wait a few minutes.' }),
  uuid('appId'), validate,
  c.vendor.pay,
);

// ═══ Public ════════════════════════════════════════════════════════════════
const publicRouter = express.Router({ mergeParams: true });
publicRouter.get('/', param('slug').isString().isLength({ min: 1, max: 200 }), validate, c.publicPage.page);
publicRouter.post(
  '/applications',
  makeLimiter({ windowMs: 60 * 60 * 1000, max: 5, name: 'vendor-apply', message: 'You have sent several applications. Please wait a while before sending another.' }),
  param('slug').isString().isLength({ min: 1, max: 200 }),
  body('businessName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter your business name.'),
  body('contactName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter your name.'),
  body('contactEmail').isEmail().withMessage('Enter a valid email address.'),
  body('contactPhone').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  http('website'),
  body('category').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('description').isString().trim().isLength({ min: 10, max: 1000 }).withMessage('Tell the organizer what you sell (at least a sentence).'),
  body('boothTypeId').optional({ values: 'falsy' }).isUUID(),
  body('answers').optional().isObject(),
  validate,
  c.publicPage.apply,
);

module.exports = { organizer, vendor, publicRouter };
