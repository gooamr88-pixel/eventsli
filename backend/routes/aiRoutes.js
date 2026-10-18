const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireActiveOrganizer } = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimit');
const ai = require('../controllers/aiController');

/**
 * Eventsli AI. Organizer accounts only, and an organizer that is banned is
 * refused by `requireActiveOrganizer` before anything is spent. The daily
 * allowance itself is counted in the database (`ai_generations`); this file
 * only bounds the request and how often it can be sent.
 */
const router = express.Router();
router.use(requireAuth, requireRole('organizer'), requireActiveOrganizer);

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * How often the button can be pressed, separately from how many drafts count.
 * Refusals before a provider is called cost nothing (D-010), so without this a
 * script could hammer the reservation function all day for free.
 */
const draftLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  name: 'ai-event-draft',
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'That is a lot of drafts in a few minutes. Wait a moment and try again.',
});

router.get('/quota', ai.getQuota);

router.post(
  '/event-drafts',
  draftLimiter,
  body('requestId').isUUID().withMessage('Send a request id.'),
  body('listingType').isIn(['ticketed', 'display_only'])
    .withMessage('Choose a ticketed event or a display-only listing.'),
  body('country').isString().trim().isLength({ min: 2, max: 2 })
    .withMessage('Country must be a two-letter code, e.g. CA or US.'),
  body('timezone').isString().trim().custom(isTimeZone)
    .withMessage('Choose a time zone from the list, e.g. America/Toronto.'),
  // 40 so there is something to work from; 2,000 is about 600 tokens, which
  // bounds what a single press can cost on any provider.
  body('description').isString().trim().isLength({ min: 40, max: 2000 })
    .withMessage('Describe the event in 40 to 2,000 characters.'),
  validate,
  ai.createEventDraft,
);

module.exports = router;
