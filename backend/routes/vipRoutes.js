const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { makeLimiter } = require('../middleware/rateLimit');
const { requireAuth, requireRole, requireActiveOrganizer } = require('../middleware/auth');
const c = require('../controllers/vipController');
const { SERVICE_KEYS } = require('../services/vip/vipSettings');

/**
 * VIP Services — the organizer's side (2026-11-28), at /api/v1/organizer/vip.
 * Mounted ahead of the general organizer router so these paths win.
 *
 * And Meta's WhatsApp webhook, at /api/v1/webhooks/whatsapp: no session, the
 * signature is the authentication (controllers/vipController.js).
 */
const organizer = express.Router();
organizer.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);

// Each request emails the team, and a WhatsApp template costs money.
const createLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000, max: 10, name: 'vip-create',
  message: 'That is a lot of requests in an hour. Message us on WhatsApp instead.',
});
const messageLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000, max: 40, name: 'vip-message',
  message: 'Too many messages just now. Please wait a few minutes.',
});

const phone = (field) => body(field).optional({ values: 'falsy' }).isString().isLength({ max: 32 });

organizer.get('/', c.list);
organizer.get('/options', c.options);
organizer.post(
  '/',
  createLimiter,
  body('services').isArray({ min: 1, max: 12 }).withMessage('Choose at least one service.'),
  body('services.*').isIn(SERVICE_KEYS),
  body('eventId').optional({ values: 'falsy' }).isUUID(),
  body('eventName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 160 }),
  body('eventDate').optional({ values: 'falsy' }).isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('Choose the event date.'),
  body('guestCount').optional({ values: 'falsy' }).isInt({ min: 1, max: 1000000 }).withMessage('Enter the number of guests.'),
  body('budget').optional({ values: 'falsy' }).isString().isLength({ max: 40 }),
  body('details').isString().trim().isLength({ min: 10, max: 4000 }).withMessage('Tell us a little about what you need (at least 10 characters).'),
  body('contactName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Enter your name.'),
  body('contactEmail').isString().trim().isEmail().isLength({ max: 254 }).withMessage('Enter a valid email address.'),
  phone('whatsappNumber'),
  body('whatsappOptIn').optional().isBoolean({ strict: true }),
  body('preferredChannel').optional().isIn(['whatsapp', 'email']),
  validate,
  c.create,
);
// Before '/:id', or 'media' would be read as a request id.
organizer.get('/media/:messageId', param('messageId').isUUID(), validate, c.organizerMedia);
organizer.get('/:id', param('id').isUUID(), validate, c.get);
organizer.post(
  '/:id/messages',
  messageLimiter,
  param('id').isUUID(),
  body('text').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Write a message.'),
  validate,
  c.message,
);
organizer.patch(
  '/:id/contact',
  param('id').isUUID(),
  body('whatsappNumber').optional({ values: 'null' }).isString().isLength({ max: 32 }),
  body('whatsappOptIn').optional().isBoolean({ strict: true }),
  body('preferredChannel').optional().isIn(['whatsapp', 'email']),
  validate,
  c.updateContact,
);
organizer.post(
  '/:id/cancel',
  param('id').isUUID(),
  body('reason').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  validate,
  c.cancel,
);

const webhooks = express.Router();
webhooks.get('/whatsapp', c.webhookVerify);
webhooks.post('/whatsapp', c.webhookReceive);

module.exports = { organizer, webhooks };
