const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { makeLimiter } = require('../middleware/rateLimit');
const { optionalAuth } = require('../middleware/auth');
const c = require('../controllers/vipController');
const { SERVICE_KEYS } = require('../services/vip/vipSettings');

/**
 * VIP Services for every visitor (owner, 2026-11-28: "make this available
 * also for all visitors"). Mounted at /api/v1/public/vip, ahead of the
 * general public router.
 *
 * No account needed. A request is limited per address (each one emails the
 * team, and may send a paid WhatsApp template); the visitor's own routes
 * need the token from their private link, and answer "not found" without it.
 */
const router = express.Router();
router.use(optionalAuth);

const createLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000, max: 5, name: 'vip-public-create',
  message: 'That is a lot of requests from here. Message us on WhatsApp instead.',
});
const messageLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000, max: 30, name: 'vip-public-message',
  message: 'Too many messages just now. Please wait a few minutes.',
});

const token = (where) => where('t').isString().isLength({ min: 32, max: 32 });

router.get('/', c.publicOptions);

router.post(
  '/requests',
  createLimiter,
  body('services').isArray({ min: 1, max: 12 }).withMessage('Choose at least one service.'),
  body('services.*').isIn(SERVICE_KEYS),
  body('eventName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 160 }),
  body('eventDate').optional({ values: 'falsy' }).isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('Choose the event date.'),
  body('guestCount').optional({ values: 'falsy' }).isInt({ min: 1, max: 1000000 }).withMessage('Enter the number of guests.'),
  body('budget').optional({ values: 'falsy' }).isString().isLength({ max: 40 }),
  body('details').isString().trim().isLength({ min: 10, max: 4000 }).withMessage('Tell us a little about what you need (at least 10 characters).'),
  body('contactName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter your name.'),
  body('contactEmail').isString().trim().isEmail().isLength({ max: 254 }).withMessage('Enter a valid email address.'),
  body('company').optional({ values: 'falsy' }).isString().trim().isLength({ max: 160 }),
  body('whatsappNumber').optional({ values: 'falsy' }).isString().isLength({ max: 32 }),
  body('whatsappOptIn').optional().isBoolean({ strict: true }),
  body('preferredChannel').optional().isIn(['whatsapp', 'email']),
  body('website').optional().isString().isLength({ max: 200 }),
  validate,
  c.publicCreate,
);

router.get('/requests/:id', param('id').isUUID(), token(query), validate, c.publicGet);
router.post(
  '/requests/:id/messages',
  messageLimiter,
  param('id').isUUID(), token(body),
  body('text').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Write a message.'),
  validate,
  c.publicMessage,
);
router.patch(
  '/requests/:id/contact',
  param('id').isUUID(), token(body),
  body('whatsappNumber').optional({ values: 'null' }).isString().isLength({ max: 32 }),
  body('whatsappOptIn').optional().isBoolean({ strict: true }),
  body('preferredChannel').optional().isIn(['whatsapp', 'email']),
  validate,
  c.publicContact,
);
router.post(
  '/requests/:id/cancel',
  param('id').isUUID(), token(body),
  body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  validate,
  c.publicCancel,
);
router.get('/requests/:id/media/:messageId', param('id').isUUID(), param('messageId').isUUID(), token(query), validate, c.publicMedia);

module.exports = router;
