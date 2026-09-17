const express = require('express');
const { makeLimiter } = require('../middleware/rateLimit');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const categoryService = require('../services/categoryService');
const c = require('../controllers/seatMapController');

const router = express.Router();

/**
 * Table passwords are low-entropy by nature — an organizer picks something a
 * guest can be told over the phone. Without a tight limit here, a protected
 * table is one short script away from being public, and the attempt leaves no
 * trace on any account because there is no account involved.
 *
 * Keyed by IP and table, so guessing at one table does not consume the budget
 * for another and one address cannot sweep the map.
 */
const unlockLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip}|${req.params.tableId}`,
  message: 'Too many attempts for this table. Please wait a few minutes.',
});

/**
 * Holding is cheap for the buyer and expensive for everyone else: each attempt
 * takes stock off sale for the TTL. Bounded so one client cannot quietly hold
 * a whole room while never paying.
 */
const holdLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: 'Too many attempts. Please wait a moment before selecting again.',
});

// ─── Discovery ──────────────────────────────────────────────────────────────
// Until these existed the platform could sell to anyone who already had the
// link and had no way for anyone else to arrive.
//
// Ordered BEFORE `/events/:slug/seat-map` only for readability — Express
// matches on the full path, so `/events` and `/events/:slug` cannot shadow it.
const discovery = require('../controllers/discoveryController');

router.get(
  '/events',
  query('q').optional().isString().trim().isLength({ max: 200 }),
  query('country').optional().isString().trim().isLength({ min: 2, max: 2 }),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('includePast').optional().isIn(['true', 'false']),
  query('city').optional().isString().trim().isLength({ min: 1, max: 120 }),
  // Checked here rather than passed through. The column is now TEXT with a
  // foreign key rather than an enum, so an unknown value is no longer a failed
  // cast — it is simply a filter that matches nothing, which would answer a
  // typo with an empty listing and no explanation.
  //
  // `knownSlugs()` returns null until the cache has loaded; a null means "let
  // it through and let the query answer", because 400-ing every request in the
  // first second after a restart is worse than a rare unexplained empty page.
  query('category').optional().custom(categoryService.assertKnownSlug),
  validate,
  discovery.listEvents,
);

// The categories themselves, so a browse page renders the real set instead of
// hard-coding a copy that drifts the first time one is added.
//
// Now returns objects rather than slugs: the label lives in the database, and
// the frontend was deriving "Food & drink" from `food_drink` through a map that
// was a second copy of this table. `labels` is kept alongside for any caller
// still reading the old shape.
router.get('/event-categories', async (req, res, next) => {
  try {
    const categories = await categoryService.list({ enabledOnly: true });
    return sendOk(res, {
      categories: categories.map((cat) => cat.slug),
      labelled: categories.map(({ slug, label, blurb, imageUrl }) => ({ slug, label, blurb, imageUrl })),
    });
  } catch (err) { return next(err); }
});

// ─── The landing page ───────────────────────────────────────────────────────
const landing = require('../controllers/landingController');

router.get('/landing', landing.landing);
router.get('/cities', landing.cities);

/**
 * The nearest city that has something on, from a pair of coordinates.
 *
 * Rate-limited: it is unauthenticated and it reads the events table, and the
 * button that calls it is one tap on the busiest page on the site.
 */
router.get(
  '/cities/nearest',
  makeLimiter({ windowMs: 60 * 1000, max: 20, name: 'nearest-city', message: 'Too many requests.' }),
  query('lat').isFloat({ min: -90, max: 90 }),
  query('lng').isFloat({ min: -180, max: 180 }),
  validate,
  landing.nearestCity,
);

/**
 * The full "near me" answer: every city with something on, by distance.
 *
 * Same limiter budget as the single-city lookup — it is the same button, and
 * this is the call it actually makes.
 */
router.get(
  '/events/near',
  makeLimiter({ windowMs: 60 * 1000, max: 20, name: 'events-near', message: 'Too many requests.' }),
  query('lat').isFloat({ min: -90, max: 90 }),
  query('lng').isFloat({ min: -180, max: 180 }),
  query('radiusKm').optional().isInt({ min: 5, max: 2000 }),
  validate,
  landing.eventsNear,
);

/**
 * The visit beacon. Rate-limited because it is an unauthenticated write: the
 * counter is per-day and per-visitor so repeat calls cannot inflate the
 * "visitors" figure, but they can inflate "views", and nothing else in the
 * system stops a script from calling this in a loop.
 */
router.post(
  '/visit',
  makeLimiter({
    windowMs: 60 * 1000,
    max: 30,
    name: 'site-visit',
    message: 'Too many requests.',
  }),
  body('path').isString().isLength({ min: 1, max: 200 }),
  validate,
  landing.recordVisit,
);

/**
 * The current terms, as published.
 *
 * The frontend MUST render these rather than carry its own copy. Acceptance is
 * recorded against a version id (BRD §21) — so hard-coded page copy would go on
 * showing v1 the day v2 is published, and every buyer would be agreeing to a
 * version they were never shown. That is precisely the failure versioning
 * exists to prevent.
 *
 * Public and uncached-by-id: a person must be able to read what they are being
 * asked to agree to without an account.
 */
router.get(
  '/terms/:audience',
  param('audience').isIn(['organizer', 'buyer']),
  validate,
  async (req, res, next) => {
    try {
      const terms = await require('../services/termsService').currentVersion(req.params.audience);
      return sendOk(res, {
        id: terms.id,
        version: terms.version,
        audience: terms.audience,
        bodyMarkdown: terms.body_md,
        publishedAt: terms.published_at,
      });
    } catch (err) {
      if (err.code === 'CONFLICT') {
        return sendFail(res, { status: 404, error: 'NOT_FOUND', message: err.message });
      }
      return next(err);
    }
  },
);

router.get('/events/:slug', discovery.eventBySlug);

router.get('/events/:slug/seat-map', c.publicMap);

router.post(
  '/events/:slug/tables/:tableId/unlock',
  unlockLimiter,
  param('tableId').isUUID(),
  body('password').isString().isLength({ min: 1, max: 200 })
    .withMessage('Enter the table password.'),
  validate,
  c.unlockTable,
);

router.post(
  '/events/:slug/hold',
  holdLimiter,
  // optionalAuth, not requireAuth: guest checkout is a first-class path, and
  // making someone create an account before they can hold a seat is where
  // conversion goes to die.
  optionalAuth,
  body('seatIds').optional().isArray({ min: 1, max: 100 }),
  body('seatIds.*').optional().isUUID(),
  body('tableId').optional().isUUID(),
  // General admission: a quantity of each ticket type. The per-line and total
  // caps are enforced in `hold_general` against the event's own limit; these
  // bounds only keep an absurd request from reaching it.
  body('lines').optional().isArray({ min: 1, max: 20 }),
  body('lines.*.tierId').optional().isUUID(),
  body('lines.*.quantity').optional().isInt({ min: 1, max: 100 }),
  body().custom((value) => {
    const chosen = [value.tableId, value.seatIds, value.lines].filter(Boolean).length;
    if (chosen === 0) {
      throw new Error('Choose seats, a table, or how many tickets you want.');
    }
    if (chosen > 1) {
      // Three different prices and three different rules; refusing is clearer
      // than guessing which one they meant.
      throw new Error('Choose one of seats, a whole table, or a number of tickets.');
    }
    return true;
  }),
  validate,
  c.hold,
);

router.post(
  '/reservations/:reservationId/release',
  param('reservationId').isUUID(),
  validate,
  c.release,
);

// ─── Checkout ───────────────────────────────────────────────────────────────
const checkout = require('../controllers/checkoutController');

router.get(
  '/reservations/:reservationId/quote',
  param('reservationId').isUUID(),
  validate,
  checkout.quote,
);

router.post(
  '/reservations/:reservationId/checkout',
  holdLimiter,
  // optionalAuth, not requireAuth: guest checkout is a first-class path, and
  // making someone create an account before they can pay is where conversion
  // goes to die.
  optionalAuth,
  param('reservationId').isUUID(),
  body('email').optional().isEmail().normalizeEmail(),
  body('name').optional().isString().trim().isLength({ max: 120 }),
  body('phone').optional().isString().trim().matches(/^[0-9+\-() ]{7,20}$/),
  // BRD §21 — required, and only a real JSON `true` counts. `optional()` here
  // let a checkout without the buyer's agreement through for as long as the
  // page happened to send it.
  body('acceptTerms').custom((v) => v === true)
    .withMessage('Accept the terms to continue to payment.'),
  validate,
  checkout.createSession,
);

/**
 * Claiming free tickets. Same guards as the paid checkout — identify yourself,
 * accept the terms — and no payment step, because there is nothing to pay.
 *
 * Rate limited with `holdLimiter` like the paid route: it converts a hold into
 * tickets, so it moves stock, and free stock is exactly the kind a script would
 * be pointed at.
 */
router.post(
  '/reservations/:reservationId/claim',
  holdLimiter,
  optionalAuth,
  param('reservationId').isUUID(),
  body('name').optional().isString().trim().isLength({ max: 120 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isString().trim().isLength({ max: 30 }),
  // BRD §21 — refused here as well as in the handler, so no other caller can
  // route around the checkbox.
  body('acceptTerms').equals('true').withMessage('Accept the terms to claim your tickets.')
    .customSanitizer(() => true),
  validate,
  checkout.claimFree,
);

router.get('/checkout/:sessionId', checkout.checkoutResult);

// ─── Promo codes ────────────────────────────────────────────────────────────
const promo = require('../controllers/promoController');

/**
 * Codes are short and guessable by design — they get printed on flyers. Without
 * a limit someone can enumerate the namespace and find every live discount on
 * the platform, and the attempt touches no account so nothing else notices.
 */
const promoLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  message: 'Too many code attempts. Please wait a few minutes.',
});

router.post(
  '/reservations/:reservationId/promo',
  promoLimiter,
  param('reservationId').isUUID(),
  body('code').isString().trim().isLength({ min: 2, max: 40 })
    .withMessage('Enter a discount code.'),
  validate,
  promo.apply,
);

router.delete(
  '/reservations/:reservationId/promo',
  param('reservationId').isUUID(),
  validate,
  promo.remove,
);

// ─── Tickets ────────────────────────────────────────────────────────────────
const ticketCtrl = require('../controllers/ticketController');

/**
 * The emailed link. The signed token IS the proof — it went to the address that
 * bought the tickets and nowhere else.
 */
router.get(
  '/t/:token',
  param('token').isString().isLength({ min: 20, max: 2000 }),
  validate,
  ticketCtrl.byToken,
);

/**
 * The QR image itself, drawn by us.
 *
 * It used to be an <img> pointing at a public QR service with the signed
 * admission token in the query string — which put the credential that opens the
 * door into a third party's access logs, for every ticket ever sold.
 *
 * No rate limiter: it is an <img> in an email, so a mail client fetching one
 * per ticket in a burst is the normal case, and throttling it means a guest
 * whose codes render as broken images. The token's signature is the gate, and
 * an unsigned request is refused before any work happens.
 */
router.get(
  '/qr/:token',
  param('token').isString().isLength({ min: 20, max: 2000 }),
  validate,
  ticketCtrl.qrImage,
);

/**
 * "I lost the email." Sends to the address ON THE ORDER, never to one supplied
 * in the request — otherwise this mails anyone's tickets to anyone. Tightly
 * limited, because the reply is identical whether or not the address matched
 * and the only cost of guessing is our sending budget.
 */
router.post(
  '/tickets/resend',
  makeLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    name: 'ticket-resend',
    message: 'Too many requests. Please wait an hour and try again.',
  }),
  body('email').isEmail().normalizeEmail().withMessage('Enter the email you bought with.'),
  validate,
  ticketCtrl.resend,
);

module.exports = router;
