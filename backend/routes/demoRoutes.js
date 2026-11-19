const express = require('express');
const { body, param, query } = require('express-validator');
const { makeLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const c = require('../controllers/demoController');

/**
 * Book a demo — the public side (2026-11-19). Mounted at /api/v1/public/demo.
 *
 * Booking is limited per address: each booking emails the team and holds a
 * slot, so a script must not be able to fill the calendar. The booker's own
 * routes need the token from their link; without it they answer "not found".
 */
const router = express.Router();

const bookLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  name: 'demo-book',
  message: 'Too many bookings from here. Please try again later.',
});
const changeLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  name: 'demo-change',
  message: 'Too many changes. Please try again in a few minutes.',
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const within45Days = (value, { req }) => {
  const from = Date.parse(req.query.from);
  const to = Date.parse(value);
  if (!(to > from) || to - from > 45 * 86_400_000) throw new Error('Ask for 45 days at most.');
  return true;
};

router.get('/', c.publicSettings);

router.get(
  '/slots',
  query('from').matches(ISO),
  query('to').matches(ISO).custom(within45Days),
  validate,
  c.publicSlots,
);

const details = [
  body('startsAt').isString().matches(ISO).withMessage('Choose a time.'),
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter your name.'),
  body('email').isString().trim().isLength({ min: 3, max: 254 }).isEmail().withMessage('Enter a valid email address.'),
  body('phone').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  body('company').optional({ values: 'falsy' }).isString().isLength({ max: 200 }),
  body('topic').optional({ values: 'falsy' }).isString().isLength({ max: 120 }),
  body('message').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
  body('answers').optional().isObject(),
  body('timezone').optional({ values: 'falsy' }).isString().isLength({ max: 64 }),
  body('website').optional().isString().isLength({ max: 200 }),
];

router.post('/bookings', bookLimiter, ...details, validate, c.book);

const token = (where) => where('t').isString().isLength({ min: 32, max: 32 });

router.get('/bookings/:id', param('id').isUUID(), token(query), validate, c.view);
router.get('/bookings/:id/calendar.ics', param('id').isUUID(), token(query), validate, c.calendar);
router.post(
  '/bookings/:id/cancel',
  changeLimiter,
  param('id').isUUID(), token(body),
  body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  validate,
  c.cancelOwn,
);
router.post(
  '/bookings/:id/reschedule',
  changeLimiter,
  param('id').isUUID(), token(body),
  body('startsAt').isString().matches(ISO).withMessage('Choose a time.'),
  validate,
  c.rescheduleOwn,
);

module.exports = router;
