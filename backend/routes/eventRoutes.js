const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const {
  requireAuth, requireRole, requireActiveOrganizer, verifyEventOwner,
} = require('../middleware/auth');
const c = require('../controllers/eventController');
const seatMap = require('../controllers/seatMapController');
const scan = require('../controllers/scanController');
const cover = require('../controllers/mediaController');
const { EVENT_CATEGORIES } = require('../services/eventRules');
const { EXTENSION_FOR } = require('../services/mediaService');

const router = express.Router();

// Everything here is the organizer's own dashboard. Ownership is checked per
// event by verifyEventOwner — the API uses the service-role database client, so
// nothing below is protected by row-level security.
router.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);

const dateRules = [
  body('startsAt').isISO8601().withMessage('Enter a valid start date and time.'),
  body('endsAt').isISO8601().withMessage('Enter a valid end date and time.')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startsAt)) {
        throw new Error('The event must end after it starts.');
      }
      return true;
    }),
];

router.post(
  '/',
  body('title').isString().trim().isLength({ min: 3, max: 200 })
    .withMessage('Give your event a title.'),
  body('country').isString().trim().isLength({ min: 2, max: 2 })
    .withMessage('Country must be a two-letter code, e.g. CA or US.'),
  body('timezone').isString().trim().notEmpty()
    .withMessage('Choose the time zone the event runs in.'),
  ...dateRules,
  body('listingType').optional().isIn(['ticketed', 'display_only']),
  body('purchaseMode').optional().isIn(['seat_only', 'table_only', 'seat_and_table']),
  // Against the exported list, never a literal array. A second copy of these
  // values is a second thing to forget when one is added to the enum.
  body('category').optional().isIn(EVENT_CATEGORIES)
    .withMessage(`Choose one of: ${EVENT_CATEGORIES.join(', ')}.`),
  body('feeBearer').optional().isIn(['buyer', 'organizer']),
  validate,
  c.create,
);

router.get('/', c.list);

router.get('/:eventId', verifyEventOwner, c.get);

router.patch(
  '/:eventId',
  verifyEventOwner,
  // Only shape-check what is present. WHICH fields an organizer may set at all
  // is decided in eventService.partitionPatch, not here — one list, one place.
  body('title').optional().isString().trim().isLength({ min: 3, max: 200 }),
  body('startsAt').optional().isISO8601(),
  body('endsAt').optional().isISO8601(),
  body('country').optional().isString().trim().isLength({ min: 2, max: 2 }),
  body('feeBearer').optional().isIn(['buyer', 'organizer']),
  body('listingType').optional().isIn(['ticketed', 'display_only']),
  body('purchaseMode').optional().isIn(['seat_only', 'table_only', 'seat_and_table']),
  body('category').optional().isIn(EVENT_CATEGORIES)
    .withMessage(`Choose one of: ${EVENT_CATEGORIES.join(', ')}.`),
  body('maxTicketsPerOrder').optional().isInt({ min: 1, max: 100 }),
  body('allowTicketTransfer').optional().isBoolean(),
  validate,
  c.update,
);

// ─── The cover image ───────────────────────────────────────────────────────
// Two steps, because the bytes never pass through this API: `cover-upload`
// signs a URL for one object key the SERVER chooses, the browser PUTs straight
// to it, and `PUT /cover` confirms the object landed before anything is
// written. `coverUrl` is not a field an organizer can set — see the note in
// eventRules.js for why a client-supplied URL is a problem on a public page.
router.post(
  '/:eventId/cover-upload',
  verifyEventOwner,
  body('contentType').isIn(Object.keys(EXTENSION_FOR))
    .withMessage('Upload a JPEG, PNG or WebP image.'),
  validate,
  cover.requestUpload,
);

router.put(
  '/:eventId/cover',
  verifyEventOwner,
  body('path').isString().trim().isLength({ min: 1, max: 300 })
    .withMessage('Send back the path from the upload step.'),
  validate,
  cover.setCover,
);

router.delete('/:eventId/cover', verifyEventOwner, cover.clearCover);

// BRD §21 — the confirmation step, before submitting.
router.post('/:eventId/accept-terms', verifyEventOwner, c.acceptTerms);

// BRD §16 — an organizer submits; only an admin publishes.
router.post('/:eventId/submit', verifyEventOwner, c.submitForReview);

// BRD §17 — cancellation is the organizer's act, not the admin's.
router.post(
  '/:eventId/cancel',
  verifyEventOwner,
  body('reason').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  c.cancel,
);

// BRD §26 — the seat map. Tables are sellable stock, not decoration.
router.get('/:eventId/venue-map', verifyEventOwner, seatMap.getMap);
router.put(
  '/:eventId/venue-map',
  verifyEventOwner,
  body('tables').isArray({ max: 400 }).withMessage('Send the tables for this map.'),
  validate,
  seatMap.putMap,
);

// BRD 18 - the gate. Devices belong to an event, not to a person.
router.get('/:eventId/gate', verifyEventOwner, scan.gateStatus);
router.get('/:eventId/scan-devices', verifyEventOwner, scan.listDevices);
router.post(
  '/:eventId/scan-devices',
  verifyEventOwner,
  body('label').isString().trim().isLength({ min: 1, max: 60 })
    .withMessage('Name the device, e.g. "Main door".'),
  body('pin').isString().isLength({ min: 4, max: 32 })
    .withMessage('Set a PIN of at least 4 characters.'),
  validate,
  scan.createDevice,
);
router.patch(
  '/:eventId/scan-devices/:deviceId',
  verifyEventOwner,
  body('isActive').isBoolean(),
  validate,
  scan.updateDevice,
);

// ─── Manual sales and the commission they create (BRD §03, §18, §20) ────────
const manual = require('../controllers/manualPaymentController');

const manualSaleRules = [
  body('seatIds').optional().isArray({ min: 1, max: 100 }),
  body('seatIds.*').optional().isUUID(),
  body('tableId').optional().isUUID(),
  body().custom((v) => {
    if (!v.tableId && !Array.isArray(v.seatIds)) throw new Error('Choose the seats or table that were sold.');
    if (v.tableId && Array.isArray(v.seatIds)) throw new Error('Record either seats or a whole table, not both.');
    return true;
  }),
];

// Quoted before recorded, so the organizer sees the debt they are creating at
// the moment they create it — not a week later on an invoice they did not expect.
router.post('/:eventId/manual-sales/quote', verifyEventOwner, ...manualSaleRules, validate, manual.quote);

router.post(
  '/:eventId/manual-sales',
  verifyEventOwner,
  ...manualSaleRules,
  body('buyerName').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Enter who bought it.'),
  body('buyerEmail').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  body('buyerPhone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 30 }),
  body('method').isString().trim().isLength({ min: 2, max: 60 })
    .withMessage('How were they paid? e.g. cash, e-transfer.'),
  body('note').optional().isString().trim().isLength({ max: 500 }),
  validate,
  manual.record,
);

router.get('/:eventId/manual-sales', verifyEventOwner, manual.listSales);
router.get('/:eventId/commission', verifyEventOwner, manual.debt);

router.post(
  '/:eventId/invoices/:invoiceId/proof',
  verifyEventOwner,
  body('proofUrl').isURL().withMessage('Attach a link to the transfer receipt.'),
  validate,
  manual.submitProof,
);

// ─── Promo codes ───────────────────────────────────────────────────────────
const promo = require('../controllers/promoController');

router.get('/:eventId/promos', verifyEventOwner, promo.list);

router.post(
  '/:eventId/promos',
  verifyEventOwner,
  body('code').isString().trim().isLength({ min: 2, max: 40 })
    .withMessage('Enter a code, e.g. EARLYBIRD.'),
  body('discountType').isIn(['percentage', 'fixed'])
    .withMessage('Choose a percentage or a fixed amount.'),
  body('discountValue').isFloat({ gt: 0 })
    .withMessage('The discount must be more than zero.'),
  body('maxUses').optional({ values: 'null' }).isInt({ min: 1 }),
  body('validFrom').optional({ values: 'falsy' }).isISO8601(),
  body('validUntil').optional({ values: 'falsy' }).isISO8601(),
  validate,
  promo.create,
);

router.patch(
  '/:eventId/promos/:promoId',
  verifyEventOwner,
  body('isActive').isBoolean(),
  validate,
  promo.setActive,
);

// ─── Ticket tiers ──────────────────────────────────────────────────────────
// The named price bands. Until these existed, `seat_price_cents` fell through
// its final COALESCE and a seat with no override sold for nothing.
const tiers = require('../controllers/tierController');

router.get('/:eventId/tiers', verifyEventOwner, tiers.list);

router.post(
  '/:eventId/tiers',
  verifyEventOwner,
  body('name').isString().trim().isLength({ min: 1, max: 80 })
    .withMessage('Give the tier a name, e.g. General Admission.'),
  body('description').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
  // Integer cents, never a float. `parseFloat("19.99") * 100` is not 1999.
  body('priceCents').isInt({ min: 0 })
    .withMessage('The price must be a whole number of cents.'),
  // null is meaningful: "bounded by the seat map", not "none left".
  body('quantity').optional({ values: 'null' }).isInt({ min: 1 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  validate,
  tiers.create,
);

router.patch(
  '/:eventId/tiers/:tierId',
  verifyEventOwner,
  param('tierId').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
  body('priceCents').optional().isInt({ min: 0 }),
  body('quantity').optional({ values: 'null' }).isInt({ min: 0 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  validate,
  tiers.update,
);

router.delete('/:eventId/tiers/:tierId', verifyEventOwner, param('tierId').isUUID(),
  validate, tiers.remove);

// ─── Table categories (BRD §24) ────────────────────────────────────────────
// Presentation, not pricing — a table keeps its own price.
const categories = require('../controllers/tableCategoryController');

router.get('/:eventId/table-categories', verifyEventOwner, categories.list);

router.post(
  '/:eventId/table-categories',
  verifyEventOwner,
  body('name').isString().trim().isLength({ min: 1, max: 80 })
    .withMessage('Give the category a name, e.g. Front row.'),
  body('color').optional({ values: 'falsy' }).isString().trim().isLength({ max: 7 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  validate,
  categories.create,
);

router.patch(
  '/:eventId/table-categories/:categoryId',
  verifyEventOwner,
  param('categoryId').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('color').optional({ values: 'null' }).isString().trim().isLength({ max: 7 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  validate,
  categories.update,
);

router.delete('/:eventId/table-categories/:categoryId', verifyEventOwner,
  param('categoryId').isUUID(), validate, categories.remove);

// ─── Sales and the door list ───────────────────────────────────────────────
// `/manual-sales` filters channel = 'manual', so until these existed an
// organizer could see the cash taken at the door and nothing sold online.
const sales = require('../controllers/salesController');

router.get(
  '/:eventId/orders',
  verifyEventOwner,
  query('channel').optional().isIn(['stripe', 'manual']),
  query('status').optional().isIn(['pending', 'paid', 'failed', 'cancelled', 'all']),
  validate,
  sales.orders,
);

router.get(
  '/:eventId/attendees',
  verifyEventOwner,
  query('status').optional().isIn(['valid', 'scanned', 'void']),
  query('checkedIn').optional().isIn(['true', 'false']),
  validate,
  sales.attendees,
);

module.exports = router;