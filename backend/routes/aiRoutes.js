const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const {
  requireAuth, requireRole, requireActiveOrganizer, verifyEventOwner,
} = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimit');
const ai = require('../controllers/aiController');
const { TYPES, MAX_BASE64 } = require('../services/ai/posterImage');
const { TONES } = require('../services/ai/launchKit');

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

/** What every draft request carries, whatever it is drafted from. */
const draftBasics = () => [
  body('requestId').isUUID().withMessage('Send a request id.'),
  body('listingType').isIn(['ticketed', 'display_only'])
    .withMessage('Choose a ticketed event or a display-only listing.'),
  body('country').isString().trim().isLength({ min: 2, max: 2 })
    .withMessage('Country must be a two-letter code, e.g. CA or US.'),
  body('timezone').isString().trim().custom(isTimeZone)
    .withMessage('Choose a time zone from the list, e.g. America/Toronto.'),
];

router.get('/quota', ai.getQuota);

router.post(
  '/event-drafts',
  draftLimiter,
  ...draftBasics(),
  // 40 so there is something to work from; 2,000 is about 600 tokens, which
  // bounds what a single press can cost on any provider.
  body('description').isString().trim().isLength({ min: 40, max: 2000 })
    .withMessage('Describe the event in 40 to 2,000 characters.'),
  validate,
  ai.createEventDraft,
);

/**
 * From a poster. The SAME limiter instance as above, so a description and a
 * poster share one budget of presses rather than getting ten each. The
 * image's bytes are checked properly in the controller (`readPosterImage`,
 * by signature and dimensions); these only bound the request's shape and
 * length before anything is decoded.
 */
router.post(
  '/event-drafts/from-image',
  draftLimiter,
  ...draftBasics(),
  body('notes').optional({ values: 'null' }).isString().trim().isLength({ max: 1000 })
    .withMessage('Keep the note under 1,000 characters.'),
  body('image').isObject().withMessage('Add a poster image.'),
  body('image.mimeType').isIn(TYPES).withMessage('Upload the poster as a JPEG, PNG or WebP image.'),
  // A data: prefix is allowed and stripped, hence the small allowance.
  body('image.data').isString().isLength({ min: 1, max: MAX_BASE64 + 64 })
    .withMessage('That image is too large. Use one under 1.4 MB.'),
  validate,
  ai.createEventDraftFromImage,
);

/**
 * The Seating Designer and the launch kit work on one SAVED event, so the
 * event's owner is checked first (`verifyEventOwner`), and both share the
 * draft limiter above: one budget of presses across every AI button.
 */
router.post(
  '/events/:eventId/seating-plan',
  draftLimiter,
  verifyEventOwner,
  body('requestId').isUUID().withMessage('Send a request id.'),
  body('description').isString().trim().isLength({ min: 20, max: 1500 })
    .withMessage('Describe the room in 20 to 1,500 characters.'),
  validate,
  ai.createSeatingPlan,
);

router.post(
  '/events/:eventId/launch-kit',
  draftLimiter,
  verifyEventOwner,
  body('requestId').isUUID().withMessage('Send a request id.'),
  body('tone').optional().isIn(TONES).withMessage(`Choose a tone: ${TONES.join(', ')}.`),
  body('note').optional({ values: 'null' }).isString().trim().isLength({ max: 300 })
    .withMessage('Keep the note under 300 characters.'),
  validate,
  ai.createLaunchKit,
);

module.exports = router;
