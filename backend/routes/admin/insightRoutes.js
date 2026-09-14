const express = require('express');
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const insight = require('../../controllers/admin/insightController');
const events = require('../../controllers/admin/eventAdminController');

/**
 * The admin console's read side (BRD §19, §20): the overview, every event and
 * every organizer. Actions stay in approvalRoutes and userRoutes — this router
 * has no write in it, which is a property worth keeping.
 */
const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const STATUSES = ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'cancelled', 'completed'];

router.get('/overview', query('days').optional().isIn(['7', '30', '90']), validate, insight.overview);

router.get(
  '/events',
  query('status').optional().isIn(STATUSES),
  query('organizerId').optional().isUUID(),
  query('when').optional().isIn(['upcoming', 'past']),
  validate,
  events.list,
);

router.get('/events/:eventId', param('eventId').isUUID(), validate, events.detail);

router.get(
  '/organizers',
  query('banned').optional().isIn(['true', 'false']),
  query('payouts').optional().isIn(['ready', 'missing']),
  validate,
  insight.organizers,
);

module.exports = router;
