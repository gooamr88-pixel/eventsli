const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { makeLimiter } = require('../../middleware/rateLimit');
const c = require('../../controllers/venueMapTemplateController');
const ai = require('../../controllers/aiController');
const { KINDS } = require('../../services/venueMapTemplateService');
const { TYPES, MAX_BASE64 } = require('../../services/ai/posterImage');

/**
 * Eventsli's venue map library (2026-11-24), under the admin guard in
 * routes/admin/index.js. Mount it only there.
 *
 * READS FOR EVERY ADMIN, WRITES FOR A SUPER ADMIN, by method at router level
 * like the event templates: a map published here is offered to every
 * organizer on the platform. Reading a seating-chart picture is a write too
 * (it spends AI), with its own limiter.
 */
const router = express.Router();

const superAdmin = requireRole('super_admin');
router.use('/venue-maps', (req, res, next) => (
  req.method === 'GET' || req.method === 'HEAD' ? next() : superAdmin(req, res, next)
));

const readLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  name: 'admin-venue-map-read',
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'That is a lot of pictures in a few minutes. Wait a moment and try again.',
});

const venueFields = (prefix) => [
  body(`${prefix}.name`).isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name the venue (2 to 120 characters).'),
  body(`${prefix}.address`).optional({ values: 'null' }).isString().isLength({ max: 300 }),
  body(`${prefix}.city`).optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body(`${prefix}.region`).optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body(`${prefix}.country`).optional({ values: 'falsy' }).isString().matches(/^[A-Za-z]{2}$/).withMessage('Use a two-letter country code.'),
  body(`${prefix}.placeId`).optional({ values: 'null' }).isString().isLength({ max: 300 }),
  body(`${prefix}.lat`).optional({ values: 'null' }).isFloat({ min: -90, max: 90 }),
  body(`${prefix}.lng`).optional({ values: 'null' }).isFloat({ min: -180, max: 180 }),
  body(`${prefix}.kind`).optional().isIn(KINDS).withMessage('Choose a kind of venue.'),
];
const text = () => [
  body('name').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('sourceNote').optional({ values: 'null' }).isString().isLength({ max: 300 }),
];
// The map: an event to copy it from, or map data (a picture read in the browser).
const mapSource = () => [
  body('eventId').optional({ values: 'falsy' }).isUUID().withMessage('Choose the event to copy the map from.'),
  body('data').if(body('eventId').not().exists({ values: 'falsy' })).isObject().withMessage('Choose where the map comes from.'),
  body('data.tables').optional().isArray({ max: 400 }),
];

router.get(
  '/venue-maps',
  query('scope').optional().isIn(['platform', 'organizer']),
  query('q').optional().isString().isLength({ max: 80 }),
  query('status').optional({ values: 'falsy' }).isIn(['draft', 'published', 'hidden']),
  query('kind').optional({ values: 'falsy' }).isIn(KINDS),
  validate,
  c.adminList,
);
router.get(
  '/venue-maps/venue-events',
  query('placeId').optional().isString().isLength({ max: 300 }),
  query('name').optional().isString().isLength({ max: 120 }),
  query('city').optional().isString().isLength({ max: 120 }),
  validate,
  c.adminVenueEvents,
);
router.get('/venue-maps/read-image/:jobId', param('jobId').isUUID(), validate, ai.getVenueMapImageJob);
router.get('/venue-maps/:id', param('id').isUUID(), validate, c.adminGet);

router.post(
  '/venue-maps/read-image',
  readLimiter,
  body('requestId').isUUID().withMessage('Send a request id.'),
  body('notes').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }),
  body('image').isObject().withMessage('Add a picture of the seating chart.'),
  body('image.mimeType').isIn(TYPES).withMessage('Upload the chart as a JPEG, PNG or WebP image.'),
  body('image.data').isString().isLength({ min: 1, max: MAX_BASE64 + 64 })
    .withMessage('That image is too large. Use one under 1.4 MB.'),
  validate,
  ai.readVenueMapImage,
);
router.post('/venue-maps', ...venueFields('venue'), ...text(), ...mapSource(), body('verified').optional().isBoolean({ strict: true }), validate, c.adminCreate);
router.put('/venue-maps/:id/map', param('id').isUUID(), ...mapSource(), validate, c.adminReplaceMap);
router.post('/venue-maps/:id/promote', param('id').isUUID(), validate, c.adminPromote);
router.patch(
  '/venue-maps/:id',
  param('id').isUUID(),
  ...text(),
  // The service trims and checks every venue field (venueRow) and refuses a
  // venue without a name.
  body('venue').optional().isObject(),
  body('venueKind').optional().isIn(KINDS),
  body('status').optional().isIn(['draft', 'published', 'hidden']),
  body('featured').optional().isBoolean({ strict: true }),
  body('verified').optional().isBoolean({ strict: true }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  validate,
  c.adminUpdate,
);
router.delete('/venue-maps/:id', param('id').isUUID(), validate, c.adminRemove);

module.exports = router;
