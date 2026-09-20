const express = require('express');
const { query, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimit');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const places = require('../services/placesService');

const router = express.Router();

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENUE SEARCH — the two calls the create-event wizard makes.
 *
 * `services/placesService.js` argues why this is proxied rather than called from
 * the browser. The short version: the key stays ours, the CSP does not have to
 * admit Google on every page of the site, and the spend sits behind a limiter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATED, AND ORGANIZER-ONLY. This is not a public search box.
 *
 * Every call here costs money on our account. The only screen that uses it is
 * the create-event wizard, whose reader is by definition an organizer with a
 * profile — `requireRole('organizer')` is exactly that population, and it is the
 * same gate `POST /events` is behind, so nobody who can reach the wizard is
 * refused by this.
 *
 * Public would be the natural instinct, because "search for a place" sounds
 * harmless. It is a metered third-party API with our key on it: public means an
 * uncapped bill payable by anyone who finds the URL.
 *
 * If a buyer-facing venue search is ever wanted, it gets its own route with its
 * own limiter and its own argument — not a widening of this one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Sized to a person typing, not to a person searching.
 *
 * The client debounces at 250ms and asks only from the third character, so a
 * venue name typed at speed is a handful of requests and choosing it is one
 * more. 60 in five minutes is far above that and far below anything that could
 * run up a bill — and it is keyed on the ACCOUNT rather than the IP, because an
 * office of organizers behind one address must not exhaust each other.
 */
const searchLimiter = makeLimiter({
  name: 'places',
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => `places|${req.user?.id || req.ip}`,
  message: 'Too many venue searches. Wait a moment and try again.',
});

/**
 * NOT CONFIGURED IS A 503 WITH A CODE THE CLIENT ACTS ON.
 *
 * `GOOGLE_PLACES_API_KEY` is optional, and a deployment without it is a
 * supported state rather than a broken one — the wizard's venue field is then
 * the plain text input it has always been. The client reads `PLACES_DISABLED`
 * once, stops asking for the rest of the page's life, and shows no error: there
 * is nothing wrong from the organizer's point of view, there is simply no
 * autocomplete.
 *
 * A 404 would be wrong (the route exists) and a 500 would be wrong (nothing
 * failed). 503 with a specific code is the honest answer, and it keeps the
 * difference between "off" and "broken" legible in our own logs.
 */
function requirePlaces(req, res, next) {
  if (!places.isEnabled()) {
    return sendFail(res, {
      status: 503,
      error: 'PLACES_DISABLED',
      message: 'Venue search is not set up on this deployment.',
    });
  }
  return next();
}

const guards = [requireAuth, requireRole('organizer'), requirePlaces, searchLimiter];

/**
 * GET /places/suggest?q=…&session=…&country=CA
 *
 * `q` is the partial venue name. Three characters is the floor in both places —
 * here and in the client — because one- and two-character queries return
 * everything and cost the same as a useful one.
 *
 * `session` groups this keystroke with the rest of the session for billing; the
 * service validates its shape before forwarding. `country` biases results
 * toward the event's own market and never restricts them.
 */
router.get(
  '/suggest',
  ...guards,
  query('q').isString().trim().isLength({ min: 3, max: 200 })
    .withMessage('Type at least three characters to search.'),
  query('session').optional().isString().trim().isLength({ max: 64 }),
  query('country').optional().isString().trim().isLength({ min: 2, max: 2 }),
  validate,
  async (req, res, next) => {
    try {
      return sendOk(res, await places.autocomplete({
        input: req.query.q,
        sessionToken: req.query.session,
        country: req.query.country,
      }));
    } catch (err) {
      // The upstream being unreachable is not this API failing. The wizard
      // treats an empty/failed suggest as "no suggestions" and the organizer
      // keeps typing, so a 502 here would turn a degraded field into a red box.
      if (err.code === 'PLACES_UPSTREAM') {
        return sendFail(res, { status: 502, error: err.code, message: err.message });
      }
      return next(err);
    }
  },
);

/**
 * GET /places/:placeId?session=…
 *
 * The one call that resolves a chosen suggestion into the four values the event
 * row stores — name, address, city, coordinates — plus the id itself.
 *
 * It is a separate request rather than data carried on the suggestion because
 * the new Places API does not return addresses or coordinates on predictions,
 * and because it is the call that CLOSES a billing session: one details request
 * per session, whatever the organizer typed to get there.
 */
router.get(
  '/:placeId',
  ...guards,
  param('placeId').isString().trim().isLength({ min: 1, max: 255 }),
  query('session').optional().isString().trim().isLength({ max: 64 }),
  validate,
  async (req, res, next) => {
    try {
      return sendOk(res, await places.details({
        placeId: req.params.placeId,
        sessionToken: req.query.session,
      }));
    } catch (err) {
      if (err.code === 'PLACES_BAD_ID') {
        return sendFail(res, { status: 400, error: err.code, message: err.message });
      }
      if (err.code === 'PLACES_UPSTREAM') {
        return sendFail(res, { status: 502, error: err.code, message: err.message });
      }
      return next(err);
    }
  },
);

module.exports = router;
