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
  // Reserved seating or general admission. The field that decides whether this
  // event ever needs a venue map — see eventRules.eventNeeds.
  body('admissionType').optional().isIn(['reserved', 'general']),
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
  // Which of the organizer's payment methods the event takes. Checked against
  // what they have set up in the controller; absent means "none yet".
  body('paymentOption').optional({ values: 'falsy' }).isIn(['both', 'stripe', 'manual'])
    .withMessage('Choose how buyers pay: Stripe, manual, or both.'),
  validate,
  c.create,
);

router.get('/', c.list);

/**
 * Started and never sent — with what each one is waiting on.
 *
 * BEFORE `/:eventId`, and it has to stay there: Express matches in order, so
 * registered after it this path would be read as an event id called "drafts"
 * and answered by `verifyEventOwner` with a 404.
 */
const drafts = require('../controllers/draftController');

router.get('/drafts', drafts.list);

router.get('/:eventId', verifyEventOwner, c.get);

// A draft is private and has never sold anything, so the organizer may remove
// it outright. Everything else archives — see the controller.
router.delete('/:eventId', verifyEventOwner, drafts.remove);

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
  body('admissionType').optional().isIn(['reserved', 'general']),
  // Content, not terms. The DB bounds the array and each entry
  // (`highlights_bounded`); this is the shape check that keeps a bad request
  // from reaching it as a constraint violation.
  body('highlights').optional().isArray({ max: 12 }),
  body('highlights.*').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('Each highlight is a short phrase, up to 120 characters.'),
  // Both or neither — `venue_coords_together` refuses half a pin.
  body('venueLat').optional({ values: 'null' }).isFloat({ min: -90, max: 90 }),
  body('venueLng').optional({ values: 'null' }).isFloat({ min: -180, max: 180 }),
  body().custom((v) => {
    const lat = v.venueLat !== undefined && v.venueLat !== null;
    const lng = v.venueLng !== undefined && v.venueLng !== null;
    if (lat !== lng) throw new Error('A map pin needs both a latitude and a longitude.');
    return true;
  }),
  body('category').optional().custom(categoryService.assertKnownSlug),
  body('city').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body('maxTicketsPerOrder').optional().isInt({ min: 1, max: 100 }),
  body('allowTicketTransfer').optional().isBoolean(),
  body('acceptsStripe').optional().isBoolean(),
  body('acceptsManual').optional().isBoolean(),
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
  // Which image this is for. Absent means the cover, so every existing caller
  // is unchanged. It reaches a storage key, so it is checked against a list
  // here and again in mediaService.
  body('slot').optional().isIn(['cover', 'logo']),
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

// ─── The logo ──────────────────────────────────────────────────────────────
// The same three steps against the other pair of columns. `slot` on the shared
// upload route decides which storage key is signed; everything else — the size
// limit, the prefix that scopes an object to this event, the confirm-then-swap
// ordering — is the cover's, unchanged.
router.put(
  '/:eventId/logo',
  verifyEventOwner,
  body('path').isString().trim().isLength({ min: 1, max: 300 })
    .withMessage('Send back the path from the upload step.'),
  validate,
  cover.setLogo,
);

router.delete('/:eventId/logo', verifyEventOwner, cover.clearLogo);

// BRD §21 — the confirmation step, before submitting.
router.post('/:eventId/accept-terms', verifyEventOwner, c.acceptTerms);

// Everything the organizer is about to agree to — the event, every fee, what a
// buyer pays and what they receive — read-only, for the confirmation dialog
// that now stands in front of the button below.
router.get('/:eventId/submission-preview', verifyEventOwner, c.submissionPreview);

// BRD §16 — an organizer submits; only an admin publishes.
router.post('/:eventId/submit', verifyEventOwner, c.submitForReview);

// BRD §17 — there is deliberately no cancel route here. The organizer cannot
// cancel an event; they ASK, and a super admin decides in the console.
const lifecycle = require('../controllers/eventLifecycleController');

router.post('/:eventId/archive', verifyEventOwner, lifecycle.archive);
router.post('/:eventId/restore', verifyEventOwner, lifecycle.restore);
router.post(
  '/:eventId/cancellation-request',
  verifyEventOwner,
  body('reason').isString().trim().isLength({ min: 10, max: 2000 })
    .withMessage('Tell Eventsli why the event needs to be cancelled (at least 10 characters).'),
  validate,
  lifecycle.requestCancellation,
);
router.delete('/:eventId/cancellation-request', verifyEventOwner, lifecycle.withdrawCancellation);

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

/**
 * The per-ticket-type rules. Shared by create and patch so the two cannot
 * accept different things — which is how a setting ends up creatable but not
 * editable, or the reverse.
 *
 * The sale window's ordering is checked by the database
 * (`tier_sale_window_ordered`); this pair is the shape check that stops a bad
 * request arriving there as a constraint violation nobody can read.
 */
const tierRuleRules = [
  body('kind').optional().isIn(['standard', 'general', 'vip', 'early_bird', 'complimentary'])
    .withMessage('Choose a ticket type: standard, general, VIP, early bird or complimentary.'),
  body('salesStartAt').optional({ values: 'null' }).isISO8601()
    .withMessage('Enter a valid date and time for when this type goes on sale.'),
  body('salesEndAt').optional({ values: 'null' }).isISO8601()
    .withMessage('Enter a valid date and time for when this type stops selling.'),
  body().custom((v) => {
    if (v.salesStartAt && v.salesEndAt && new Date(v.salesEndAt) <= new Date(v.salesStartAt)) {
      throw new Error('This ticket type must stop selling after it starts.');
    }
    return true;
  }),
  // Null is meaningful: fall back to the event's own limit.
  body('maxPerOrder').optional({ values: 'null' }).isInt({ min: 1, max: 100 })
    .withMessage('Tickets per order must be between 1 and 100.'),
  body('isHidden').optional().isBoolean(),
];

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
  ...tierRuleRules,
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
  ...tierRuleRules,
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

// ─── Event content: gallery, sponsors, policies, schedule ──────────────────
//
// Four small collections that behave alike — list, add, edit, reorder, remove —
// so they share one controller and one service. None of it is stock: nothing
// here can be held, sold, refunded or scanned, which is why none of it carries
// the guards the seat map is wrapped in.
//
// REORDER IS A PUT OF THE WHOLE LIST, not N patches. Reordering is one drag
// gesture that moves everything below what was dragged; sending a row at a time
// means any one of them failing leaves an order nobody chose.
const content = require('../controllers/eventContentController');

const idParam = [param('itemId').isUUID().withMessage('Unknown item.')];
const orderRules = [
  body('ids').isArray({ max: 200 }).withMessage('Send the items in their new order.'),
  body('ids.*').isUUID(),
];

// Everything the editor needs, in one round trip.
router.get('/:eventId/content', verifyEventOwner, content.bundle);

// Signs an upload for a gallery image or a sponsor logo. Same bucket, same size
// limit and same event-scoped prefix as the cover — that prefix is the
// ownership check, and it is worth having exactly one of.
router.post(
  '/:eventId/content/upload',
  verifyEventOwner,
  body('contentType').isIn(Object.keys(EXTENSION_FOR))
    .withMessage('Upload a JPEG, PNG or WebP image.'),
  body('kind').optional().isIn(['gallery', 'sponsor']),
  validate,
  content.requestUpload,
);

// ── Gallery and video ──
router.get('/:eventId/media', verifyEventOwner, content.listMedia);
router.post(
  '/:eventId/media',
  verifyEventOwner,
  body('kind').optional().isIn(['image', 'video']),
  // An image arrives as the path the upload step returned; a video as a link to
  // somebody else's player. Which one is required depends on which it is.
  body('path').if(body('kind').not().equals('video'))
    .isString().trim().isLength({ min: 1, max: 300 })
    .withMessage('Send back the path from the upload step.'),
  body('url').if(body('kind').equals('video'))
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Paste a link to the video.'),
  body('caption').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }),
  validate,
  content.addMedia,
);
router.patch(
  '/:eventId/media/:itemId',
  verifyEventOwner, ...idParam,
  body('caption').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }),
  validate,
  content.updateMedia,
);
router.put('/:eventId/media/order', verifyEventOwner, ...orderRules, validate, content.reorderMedia);
router.delete('/:eventId/media/:itemId', verifyEventOwner, ...idParam, validate, content.removeMedia);

// ── Sponsors ──
// `linkUrl` is an outbound link on a public page: whatever is there, this site
// is vouching for it. http(s) only, here and again in the DB constraint.
const sponsorRules = [
  body('level').optional().isIn(['headline', 'gold', 'silver', 'bronze', 'partner']),
  body('linkUrl').optional({ values: 'falsy' })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('A sponsor link must start with http:// or https://.'),
  body('path').optional().isString().trim().isLength({ min: 1, max: 300 }),
];

router.get('/:eventId/sponsors', verifyEventOwner, content.listSponsors);
router.post(
  '/:eventId/sponsors',
  verifyEventOwner,
  body('name').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('Name the sponsor.'),
  ...sponsorRules,
  validate,
  content.addSponsor,
);
router.patch(
  '/:eventId/sponsors/:itemId',
  verifyEventOwner, ...idParam,
  body('name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  ...sponsorRules,
  validate,
  content.updateSponsor,
);
router.put('/:eventId/sponsors/order', verifyEventOwner, ...orderRules, validate, content.reorderSponsors);
router.delete('/:eventId/sponsors/:itemId', verifyEventOwner, ...idParam, validate, content.removeSponsor);

// ── Policies ──
// The ORGANIZER's terms for their event. They neither replace nor amend the
// platform terms the organizer accepted in order to publish (BRD §21).
router.get('/:eventId/policies', verifyEventOwner, content.listPolicies);
router.post(
  '/:eventId/policies',
  verifyEventOwner,
  body('kind').optional().isIn(['terms', 'privacy', 'refund', 'other']),
  body('title').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('Give the policy a heading, e.g. Refunds.'),
  body('body').isString().trim().isLength({ min: 1, max: 20000 })
    .withMessage('Write the policy.'),
  body('showAtCheckout').optional().isBoolean(),
  validate,
  content.addPolicy,
);
router.patch(
  '/:eventId/policies/:itemId',
  verifyEventOwner, ...idParam,
  body('kind').optional().isIn(['terms', 'privacy', 'refund', 'other']),
  body('title').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('body').optional().isString().trim().isLength({ min: 1, max: 20000 }),
  body('showAtCheckout').optional().isBoolean(),
  validate,
  content.updatePolicy,
);
router.put('/:eventId/policies/order', verifyEventOwner, ...orderRules, validate, content.reorderPolicies);
router.delete('/:eventId/policies/:itemId', verifyEventOwner, ...idParam, validate, content.removePolicy);

// ── Schedule / lineup ──
// Times are optional: an organizer sketching a running order knows the ORDER
// before they know the clock, and a form demanding a timestamp per row turns a
// two-minute draft into a guess they have to remember to correct.
const scheduleRules = [
  body('startsAt').optional({ values: 'null' }).isISO8601(),
  body('endsAt').optional({ values: 'null' }).isISO8601(),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 2000 }),
  body('location').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body().custom((v) => {
    if (v.startsAt && v.endsAt && new Date(v.endsAt) < new Date(v.startsAt)) {
      throw new Error('That item ends before it starts.');
    }
    return true;
  }),
];

router.get('/:eventId/schedule', verifyEventOwner, content.listSchedule);
router.post(
  '/:eventId/schedule',
  verifyEventOwner,
  body('title').isString().trim().isLength({ min: 1, max: 160 })
    .withMessage('Name this part of the schedule.'),
  ...scheduleRules,
  validate,
  content.addScheduleItem,
);
router.patch(
  '/:eventId/schedule/:itemId',
  verifyEventOwner, ...idParam,
  body('title').optional().isString().trim().isLength({ min: 1, max: 160 }),
  ...scheduleRules,
  validate,
  content.updateScheduleItem,
);
router.put('/:eventId/schedule/order', verifyEventOwner, ...orderRules, validate, content.reorderSchedule);
router.delete('/:eventId/schedule/:itemId', verifyEventOwner, ...idParam, validate, content.removeScheduleItem);

module.exports = router;
