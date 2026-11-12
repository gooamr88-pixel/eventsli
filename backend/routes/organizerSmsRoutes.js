const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { sendFail } = require('../utils/responseEnvelope');
const { requireAuth, requireRole, requireActiveOrganizer } = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimit');
const c = require('../controllers/organizerSmsController');

// Counting an audience reads every buyer of the organizer's events.
const previewLimit = makeLimiter({ name: 'sms-organizer-preview', windowMs: 15 * 60_000, max: 30 });

/**
 * /api/v1/organizer/sms — an organizer's own text campaigns and audiences.
 *
 * Same guard chain as the organizer's payment methods: signed in, organizer
 * role, an organizer profile (every query is scoped by its id), and not banned.
 * Access to SEND is a separate grant checked by the controller, so an organizer
 * without it can still see why.
 */
const router = express.Router();

function requireOrganizerProfile(req, res, next) {
  if (req.user?.access?.organizerId) return next();
  return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'Create your organizer profile first.' });
}
router.use(requireAuth, requireRole('organizer'), requireOrganizerProfile);

const segmentBody = [
  body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('definition').optional().isObject(),
];
const campaignBody = [
  body('name').isString().trim().isLength({ min: 2, max: 120 }),
  body('category').isIn(['marketing', 'segmentation']),
  body('body').isString().trim().isLength({ min: 1, max: 1000 }),
  body('segmentId').optional({ values: 'null' }).isUUID(),
  body('scheduledAt').optional({ values: 'null' }).isISO8601(),
];
const ID = param('id').isUUID();

router.get('/', c.overview);
router.get('/segments', c.listSegments);
router.post('/segments', requireActiveOrganizer, ...segmentBody, validate, c.saveSegment);
router.patch('/segments/:id', requireActiveOrganizer, ID, ...segmentBody, validate, c.saveSegment);
router.delete('/segments/:id', requireActiveOrganizer, ID, validate, c.deleteSegment);
router.post('/segments/preview', previewLimit, body('definition').isObject(), validate, c.previewSegment);
router.post('/segments/:id/preview', previewLimit, ID, validate, c.previewSegment);
router.get('/campaigns', c.listCampaigns);
router.post('/campaigns', requireActiveOrganizer, ...campaignBody, validate, c.saveCampaign);
router.patch('/campaigns/:id', requireActiveOrganizer, ID, ...campaignBody, validate, c.saveCampaign);
router.post('/campaigns/:id/submit', requireActiveOrganizer, ID, validate, c.submitCampaign);
router.post('/campaigns/:id/cancel', ID, validate, c.cancelCampaign);

module.exports = router;
