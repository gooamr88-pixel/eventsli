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
const categoryService = require('../services/categoryService');
const { EXTENSION_FOR } = require('../services/mediaService');

const router = express.Router();

// Everything here is the organizer's own dashboard. Ownership is checked per
// event by verifyEventOwner — the API uses the service-role database client, so
// nothing below is protected by row-level security.
router.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);

/** True for a time zone this runtime can format in — the same check every reader of the column makes. */
function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) }).format(0);
    return true;
  } catch {
    return false;
  }
}

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
    .withMessage('Choose the time zone the event runs in.')
    // A real IANA zone, or nothing. "Toronto" used to be accepted and stored,
    // and every later `Intl.DateTimeFormat(…, { timeZone })` on that event —
    // the public page, the ticket, the emails — then threw a RangeError.
    .custom(isTimeZone).withMessage('Choose a time zone from the list, e.g. America/Toronto.'),
  ...dateRules,
  body('listingType').optional().isIn(['ticketed', 'display_only']),
  body('purchaseMode').optional().isIn(['seat_only', 'table_only', 'seat_and_table']),
  body('maxTicketsPerOrder').optional().isInt({ min: 1, max: 100 })
    .withMessage('Tickets per order must be between 1 and 100.'),
  body('allowTicketTransfer').optional().isBoolean(),
  // Against the categories the database holds, never a literal array. They are
  // rows now, editable from the admin console, so a copy here would start
  // refusing a category the moment somebody added one.
  body('category').optional().custom(categoryService.assertKnownSlug),
  body('city').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('A city name is at most 120 characters.'),
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
  body('timezone').optional().custom(isTimeZone)
    .withMessage('Choose a time zone from the list, e.g. America/Toronto.'),
  body('country').optional().isString().trim().isLength({ min: 2, max: 2 }),
  body('feeBearer').optional().isIn(['buyer', 'organizer']),
  body('listingType').optional().isIn(['ticketed', 'display_only']),
  body('purchaseMode').optional().isIn(['seat_only', 'table_only', 'seat_and_table']),
  body('category').optional().custom(categoryService.assertKnownSlug),
  body('city').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body('maxTicketsPerOrder').optional().isInt({ min: 1, max: 100 }),
  body('allowTicketTransfer').optional().isBoolean(),
  // An admin's note for the audit trail when they change an organizer's event.
  body('reason').optional().isString().trim().isLength({ max: 1000 }),
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

// BRD §17 — there is deliberately no cancel route here. The organizer cannot
// cancel an event; POST /admin/events/:eventId/cancel is the only way.

// BRD §26 — the seat map. Tables are sellable stock, not decoration.
const { makeLimiter } = require('../middleware/rateLimit');
const { NEW_PIN_PATTERN } = require('../utils/pinLockout');

// A map save can hash up to fifty new table passwords (venueService), each a
// 210k-iteration PBKDF2 on the pool login and checkout share. The editor saves
// on a button, so this is far above any real use.
const mapSaveLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  name: 'venue-map-save',
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'The map has been saved many times in a few minutes. Wait a moment and save again.',
});

router.get('/:eventId/venue-map', verifyEventOwner, seatMap.getMap);
router.put(
  '/:eventId/venue-map',
  verifyEventOwner,
  mapSaveLimiter,
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
  // Six to twelve digits for a NEW device. Existing four-digit PINs still sign
  // in (scanRoutes), and every device now locks after repeated failures.
  body('pin').isString().matches(NEW_PIN_PATTERN)
    .withMessage('Set a PIN of 6 to 12 digits.'),
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

// ─── The door team — people with their own accounts, beside the devices ────
// Scan-only and scoped to this event; see services/staffService.js.
const staff = require('../controllers/staffController');

// Per organizer: adding by email answers the same whether or not the address
// has an account, and this bounds how many addresses one organizer can try.
const staffAddLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  name: 'door-team-add',
  keyGenerator: (req) => `organizer:${req.user.access.organizerId || req.user.id}`,
  message: 'That is a lot of people added in one hour. Wait a while and try again.',
});

router.get('/:eventId/staff', verifyEventOwner, staff.list);
router.post(
  '/:eventId/staff',
  verifyEventOwner,
  staffAddLimiter,
  // normalizeEmail, because registration stores addresses normalised the same
  // way — a lookup that skipped it would miss "first.last@gmail.com".
  body('email').isEmail().normalizeEmail().withMessage('Enter the email of their Eventsli account.'),
  validate,
  staff.add,
);
router.delete('/:eventId/staff/:staffId', verifyEventOwner, param('staffId').isUUID(), validate, staff.revoke);

// ─── The event's numbers ───────────────────────────────────────────────────
const stats = require('../controllers/statsController');

router.get(
  '/:eventId/stats',
  verifyEventOwner,
  query('days').optional().isIn(['7', '30', '90']),
  validate,
  stats.eventStats,
);

// ─── Share & QR ────────────────────────────────────────────────────────────
// The browser names a tier; the server builds and validates the URL.
const share = require('../controllers/shareController');

router.get('/:eventId/share', verifyEventOwner, share.info);
router.get(
  '/:eventId/share/qr.png',
  verifyEventOwner,
  query('tier').optional().isUUID(),
  query('size').optional().isIn(['sm', 'lg']),
  query('download').optional().isIn(['1']),
  validate,
  share.qr,
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