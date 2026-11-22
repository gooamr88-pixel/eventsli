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
  name: 'table-unlock',
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
  name: 'seat-hold',
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
  // "Tickets on sale" (owner, 2026-11-15): only events sold here, never a
  // display-only listing.
  query('onSale').optional().isIn(['true', 'false']),
  // The homepage's Popular events (owner, 2026-11-17): events that sell
  // tickets here first, then listings, each soonest first.
  query('ticketedFirst').optional().isIn(['true', 'false']),
  query('city').optional().isString().trim().isLength({ min: 1, max: 120 }),
  // Cents. "Under $40" from smart search is 4000; "free" is 0.
  query('maxPrice').optional().isInt({ min: 0, max: 10_000_000 }).toInt(),
  /**
   * A comma-separated slug list, for "saved events" — a browser holds slugs in
   * localStorage and needs the events behind them.
   *
   * Length-capped rather than count-capped here, with the count enforced in the
   * controller: this string becomes a PostgREST `in.()` filter, and an
   * unbounded one is a way to make a public endpoint build an arbitrarily large
   * query. 4000 characters is roughly the 200-slug ceiling the client itself
   * keeps, with room for long slugs.
   */
  query('slugs').optional().isString().trim().isLength({ min: 1, max: 4000 }),
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

/**
 * Eventsli's own partners — the admin-published sponsors the homepage shows —
 * on their own, for every event page's partners band. The same list and the
 * same public shape as `/landing` (logo-less sponsors are left out), without
 * the rest of the landing payload.
 */
router.get('/sponsors', async (req, res, next) => {
  try {
    const storefront = require('../services/storefrontService');
    return sendOk(res, { sponsors: await storefront.listSponsors({ publicOnly: true }) });
  } catch (err) { return next(err); }
});

/**
 * The homepage hero's slider: the events an admin marked VIP, in their order,
 * that are published and not over — or, when there are none, the soonest
 * upcoming events with a cover (`chosen: false`). See vipEventsService.
 */
router.get('/vip-events', async (req, res, next) => {
  try {
    const vipEvents = require('../services/vipEventsService');
    return sendOk(res, await vipEvents.listPublic());
  } catch (err) { return next(err); }
});

/**
 * The countries organizers can choose today: the markets a super admin has
 * open in platform settings. Every country picker offers only these, so a
 * closed market is not offered and then refused on submit.
 */
router.get('/markets', async (req, res, next) => {
  try {
    const { supabase } = require('../config/supabase');
    const { SUPPORTED_MARKETS, openCountries, cardCountries } = require('../utils/markets');
    const { data, error } = await supabase
      .from('platform_settings').select('value').eq('key', 'currencies').maybeSingle();
    if (error) throw error;
    const countries = openCountries(data ? (data.value?.by_country ?? {}) : undefined);
    // Where card checkout is on. Every other open country sells offline.
    const card = cardCountries(data?.value?.card).filter((c) => countries.includes(c));
    return sendOk(res, {
      countries,
      card,
      markets: countries.map((country) => ({
        country, currency: SUPPORTED_MARKETS[country], card: card.includes(country),
      })),
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
  // How many nearby events to return (the homepage's "Near you" asks for 8).
  query('limit').optional().isInt({ min: 1, max: 24 }),
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

// ─── The homepage assistant ─────────────────────────────────────────────────
// Public and anonymous, so bounded per visitor here, per message by these
// validators, and per day in the controller (AI_ASSISTANT_DAILY_CAP).
const assistant = require('../controllers/assistantController');
const { isUnlimited } = require('../services/ai/config');

// optionalAuth so a signed-in super admin is recognised: they have no AI
// limits, here or anywhere (services/ai/config.js `isUnlimited`). Everyone
// else is the anonymous visitor this was built for.
router.get('/assistant', optionalAuth, assistant.status);
router.post(
  '/assistant/messages',
  optionalAuth,
  makeLimiter({
    windowMs: 10 * 60 * 1000, max: 20, name: 'assistant',
    skip: (req) => isUnlimited(req.user?.access),
    message: 'That is a lot of questions in a few minutes. Wait a moment, or browse events in the meantime.',
  }),
  body('messages').isArray({ min: 1, max: 12 }).withMessage('Send the conversation as a list of messages.'),
  body('messages.*.role').isIn(['user', 'assistant']),
  body('messages.*.text').isString().trim().isLength({ min: 1, max: 700 }).withMessage('Keep each message under 500 characters.'),
  body('timezone').optional().isString().isLength({ max: 64 }).custom((v) => {
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(0);
    return true;
  }),
  validate,
  assistant.reply,
);

// optionalAuth: a private event's own organizer sees it without its password.
router.get('/events/:slug', optionalAuth, discovery.eventBySlug);

/**
 * PRIVATE EVENTS (2026-11-22) — the password, checked on the server against a
 * stretched hash (services/eventAccess.js). A match sets an httpOnly cookie for
 * this one event, which the page, the seat map and the hold all read.
 *
 * Limited per address and event, as table passwords are: an event password is
 * something a guest is told, so it is guessable without a limit.
 */
const eventUnlockLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  name: 'event-unlock',
  keyGenerator: (req) => `${req.ip}|${req.params.slug}`,
  message: 'Too many attempts for this event. Please wait a few minutes.',
});

router.post(
  '/events/:slug/unlock',
  eventUnlockLimiter,
  param('slug').isString().trim().isLength({ min: 1, max: 200 }),
  body('password').isString().isLength({ min: 1, max: 200 })
    .withMessage('Enter the event password.'),
  validate,
  async (req, res, next) => {
    try {
      const eventAccess = require('../services/eventAccess');
      const { ok, event } = await eventAccess.verify(req.params.slug, req.body.password);
      if (!ok) {
        // One answer for a wrong password and for an event that is not
        // private or not there, so this is not a way to test slugs.
        return sendFail(res, {
          status: 403, error: 'EVENT_PASSWORD_INVALID', message: 'That password does not match.',
        });
      }
      // The key goes ONLY into the httpOnly cookie, never the body, so no
      // script on the page can read it. (A future client with no cookie jar
      // would get its own opt-in, sent back in `x-event-access`.)
      eventAccess.setCookie(res, event, eventAccess.issueToken(event));
      res.set('Cache-Control', 'private, no-store');
      return sendOk(res, { unlocked: true, expiresInHours: eventAccess.ACCESS_TTL_HOURS });
    } catch (err) { return next(err); }
  },
);

/**
 * "NOTIFY ME" on a coming-soon event (owner, 2026-11-17). One email, once,
 * when sales open — services/comingSoonService.js.
 *
 * Limited per address AND per event: the list is a way to reach people, so a
 * script must not be able to pour thousands of addresses into it. The answer
 * is the same for an address already on the list, so this cannot be used to
 * learn who signed up.
 */
const notifyLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  name: 'coming-soon-notify',
  keyGenerator: (req) => `${req.ip}|${req.params.slug}`,
  message: 'Too many sign-ups from here. Please try again later.',
});

router.post(
  '/events/:slug/notify',
  notifyLimiter,
  optionalAuth,
  require('../services/eventAccess').gate(),
  param('slug').isString().trim().isLength({ min: 1, max: 200 }),
  body('email').isString().trim().isLength({ min: 3, max: 254 }).isEmail()
    .withMessage('Enter a valid email address.'),
  validate,
  async (req, res, next) => {
    try {
      const comingSoon = require('../services/comingSoonService');
      const result = await comingSoon.signup({
        slug: req.params.slug, email: req.body.email, userId: req.user?.id || null,
      });
      if (result.ok) return sendOk(res, { subscribed: true });
      const refusal = {
        EVENT_NOT_FOUND: { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.' },
        INVALID_EMAIL: { status: 400, error: 'VALIDATION_ERROR', message: 'Enter a valid email address.' },
        NOT_COMING_SOON: { status: 409, error: 'CONFLICT', message: 'Tickets for this event are already on sale — reload the page to get them.' },
      }[result.code];
      return sendFail(res, refusal);
    } catch (err) { return next(err); }
  },
);

router.get('/events/:slug/seat-map', optionalAuth, c.publicMap);

router.post(
  '/events/:slug/tables/:tableId/unlock',
  unlockLimiter,
  optionalAuth,
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
  // The cart (2026-11-17): the buyer's current hold on this event, replaced by
  // this one — the body is then the COMBINED selection. Proved by the
  // `x-replace-token` header (seatMapController.hold).
  body('replaces').optional().isUUID(),
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

/**
 * THE CART — the buyer's live holds across events, grouped by organizer
 * (controllers/cartController.js). A POST because it carries the device's
 * reservation tokens, which are credentials and do not belong in a URL.
 * Signed in, the account's holds are included and the device's are claimed.
 */
const cartLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  max: 120,
  name: 'cart-view',
  message: 'Too many requests. Please wait a moment.',
});
const cart = require('../controllers/cartController');

router.post(
  '/cart',
  cartLimiter,
  optionalAuth,
  body('tokens').optional().isArray({ max: cart.MAX_ITEMS }),
  body('tokens.*').optional().isString().isLength({ min: 10, max: 2000 }),
  validate,
  cart.view,
);

router.post(
  '/reservations/:reservationId/release',
  param('reservationId').isUUID(),
  validate,
  c.release,
);

// ─── Checkout ───────────────────────────────────────────────────────────────
const checkout = require('../controllers/checkoutController');

/**
 * DELIBERATELY NOT BEHIND `ownsReservation`, unlike every sibling below it.
 *
 * `release`, `promo`, `checkout` and `claim` all demand the reservation token
 * because each SPENDS the hold. This one only prices it, and what it returns —
 * `publicBreakdown` — carries no personal data at all: a currency, the price
 * lines, the total, and how long the hold runs for. Every one of those numbers
 * is already on the public event page. The promo code appears only once the
 * holder has applied it themselves.
 *
 * The check is omitted rather than forgotten. The checkout page keeps the
 * reservation token in memory and deliberately does not persist it across a
 * reload (see `useReservation` and `CheckoutClient`), so requiring it here
 * would mean a buyer who refreshes the checkout page can no longer see what
 * they are about to pay. That is a real failure traded against an information
 * leak of published prices.
 *
 * If this endpoint ever grows a field that names the buyer, that trade changes
 * and the guard goes on.
 */
router.get(
  '/reservations/:reservationId/quote',
  param('reservationId').isUUID(),
  validate,
  checkout.quote,
);

// The buyer's add-ons for this hold — the whole choice (2026-11-17). Proved
// by the reservation token, like every other change to a hold.
router.put(
  '/reservations/:reservationId/addons',
  holdLimiter,
  param('reservationId').isUUID(),
  body('lines').isArray({ max: 20 }),
  body('lines.*.addonId').isUUID(),
  body('lines.*.quantity').isInt({ min: 0, max: 100 }),
  validate,
  checkout.setAddons,
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
  // A name on every booking (owner, 2026-11-22): the door list and the
  // organizer's orders need to know who is coming.
  body('name').isString().withMessage('Enter your full name.').trim()
    .isLength({ min: 2, max: 120 }).withMessage('Enter your full name.'),
  body('phone').optional().isString().trim().matches(/^[0-9+\-() ]{7,20}$/),
  // SMS choices, each its own boolean: transactional and marketing consent
  // are separate answers (services/sms/consent.js).
  body('sms').optional().isObject(),
  body('sms.transactional').optional().isBoolean({ strict: true }),
  body('sms.marketingPlatform').optional().isBoolean({ strict: true }),
  body('sms.marketingOrganizer').optional().isBoolean({ strict: true }),
  // BRD §21 — required, and only a real JSON `true` counts. `optional()` here
  // let a checkout without the buyer's agreement through for as long as the
  // page happened to send it.
  // Per-ticket holders (2026-11-19); each one checked in services/ticketHolders.js.
  body('holders').optional().isArray({ max: 500 }),
  body('acceptTerms').custom((v) => v === true)
    .withMessage('Accept the terms to continue to payment.'),
  // Signed under the terms (2026-11-15). Only the shape here; the points are
  // checked one by one in services/signatureService.js.
  body('signature').isObject().withMessage('Sign to continue — draw your signature, or type your name.'),
  validate,
  checkout.createSession,
);

// ─── Offline checkout (phase 2; FEATURE_DISABLED until switched on) ─────────
const offlineCtrl = require('../controllers/offlineCheckoutController');

/** Whether this hold can be paid to the organizer, with their methods and deadline. */
router.get(
  '/reservations/:reservationId/offline-options',
  optionalAuth,
  param('reservationId').isUUID(),
  validate,
  offlineCtrl.options,
);

/** Reserve and pay the organizer: the same guards as the card checkout. */
router.post(
  '/reservations/:reservationId/offline',
  holdLimiter,
  optionalAuth,
  param('reservationId').isUUID(),
  body('methodId').isUUID().withMessage('Choose how you will pay the organizer.'),
  body('email').optional().isEmail().normalizeEmail(),
  // A name on every booking (owner, 2026-11-22): the door list and the
  // organizer's orders need to know who is coming.
  body('name').isString().withMessage('Enter your full name.').trim()
    .isLength({ min: 2, max: 120 }).withMessage('Enter your full name.'),
  body('phone').optional().isString().trim().matches(/^[0-9+\-() ]{7,20}$/),
  body('sms').optional().isObject(),
  body('sms.transactional').optional().isBoolean({ strict: true }),
  body('sms.marketingPlatform').optional().isBoolean({ strict: true }),
  body('sms.marketingOrganizer').optional().isBoolean({ strict: true }),
  // Per-ticket holders (2026-11-19); each one checked in services/ticketHolders.js.
  body('holders').optional().isArray({ max: 500 }),
  body('acceptTerms').custom((v) => v === true).withMessage('Accept the terms to continue.'),
  body('signature').isObject().withMessage('Sign to continue — draw your signature, or type your name.'),
  validate,
  checkout.createOffline,
);

/** The buyer's payment page: instructions, reference, deadline, status. Token-keyed. */
router.get('/offline-payments/:id', param('id').isUUID(), validate, offlineCtrl.view);
router.post('/offline-payments/:id/cancel', holdLimiter, param('id').isUUID(), validate, offlineCtrl.cancelByBuyer);

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
  // A name on every booking (owner, 2026-11-22): the door list and the
  // organizer's orders need to know who is coming.
  body('name').isString().withMessage('Enter your full name.').trim()
    .isLength({ min: 2, max: 120 }).withMessage('Enter your full name.'),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isString().trim().isLength({ max: 30 }),
  // SMS choices, each its own boolean: transactional and marketing consent
  // are separate answers (services/sms/consent.js).
  body('sms').optional().isObject(),
  body('sms.transactional').optional().isBoolean({ strict: true }),
  body('sms.marketingPlatform').optional().isBoolean({ strict: true }),
  body('sms.marketingOrganizer').optional().isBoolean({ strict: true }),
  /**
   * BRD §21 — refused here as well as in the handler, so no other caller can
   * route around the checkbox.
   *
   * The same strict-boolean test the paid checkout uses. This used to be
   * `.equals('true')` with a sanitiser that rewrote whatever arrived into a
   * boolean `true`: `equals` stringifies first, so the literal string
   * `"true"` — and only the shape of it, from any caller — satisfied a legal
   * agreement, and the sanitiser then made the handler's own
   * `!== true` re-check unable to disagree. Two endpoints recording the same
   * consent should not accept two different things.
   */
  // Per-ticket holders (2026-11-19); each one checked in services/ticketHolders.js.
  body('holders').optional().isArray({ max: 500 }),
  body('acceptTerms').custom((v) => v === true)
    .withMessage('Accept the terms to claim your tickets.'),
  body('signature').isObject().withMessage('Sign to continue — draw your signature, or type your name.'),
  validate,
  checkout.claimFree,
);

/**
 * The success page's read of a finished checkout.
 *
 * It was the only public route in this file with neither a validator nor a
 * limiter, and it is not a cheap one: the id goes straight to the Stripe API,
 * and on a first call it can also run fulfilment. Unbounded, that is somebody
 * else's Stripe rate limit and our bill being spent by anyone who can reach
 * the box.
 *
 * SHAPE-CHECKED, not merely present. A Stripe Checkout session id is
 * `cs_test_…` / `cs_live_…` — pinning it means a malformed id is refused here
 * for nothing rather than costing an API round trip to be told the same.
 *
 * The budget is generous on purpose: this is polled by the success page while
 * the webhook lands, and a buyer refreshing after paying must never be the
 * person who gets throttled.
 */
router.get(
  '/checkout/:sessionId',
  makeLimiter({
    windowMs: 5 * 60 * 1000,
    max: 60,
    name: 'checkout-result',
    message: 'Too many requests. Wait a moment and refresh.',
  }),
  param('sessionId').matches(/^cs_[A-Za-z0-9_]{10,250}$/).withMessage('That is not a checkout session.'),
  validate,
  checkout.checkoutResult,
);

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
  name: 'promo-code',
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

// ─── Organizer profiles and messages (2026-11-18) ───────────────────────────
const organizerProfiles = require('../controllers/organizerProfileController');

/** An organizer's public page and all their published events. */
router.get(
  '/organizers/:slug',
  param('slug').isString().trim().isLength({ min: 2, max: 60 }),
  validate,
  organizerProfiles.publicProfile,
);

/**
 * "Message the organizer" from a ticket. The order token is the proof of a
 * ticket; the service also caps messages per order. This limiter is per
 * address, against one machine cycling through many links.
 */
router.post(
  '/t/:token/contact',
  makeLimiter({ windowMs: 60 * 60 * 1000, max: 10, name: 'organizer-contact', message: 'You have sent a lot of messages. Please wait a while before sending another.' }),
  param('token').isString().isLength({ min: 20, max: 2000 }),
  body('message').isString().trim().isLength({ min: 2, max: 2000 }).withMessage('Write a message of up to 2000 characters.'),
  body('name').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
  validate,
  organizerProfiles.contactFromTicket,
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
