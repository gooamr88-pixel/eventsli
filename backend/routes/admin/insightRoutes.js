const express = require('express');
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const insight = require('../../controllers/admin/insightController');
const events = require('../../controllers/admin/eventAdminController');

/**
 * The admin console's read side (BRD §19, §20): the overview, every event and
 * every organizer. Actions stay in approvalRoutes and userRoutes — this router
 * has no write in it, which is a property worth keeping.
 *
 * Guarded by routes/admin/index.js (requireAuth + admin). Mount it only there.
 */
const router = express.Router();

const STATUSES = ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'cancelled', 'completed', 'archived'];

router.get('/overview', query('days').optional().isIn(['7', '30', '90']), validate, insight.overview);

router.get(
  '/events',
  query('status').optional().isIn(STATUSES),
  query('organizerId').optional().isUUID(),
  // `now` — started and not yet ended. A live event matched neither of the
  // other two, so the one an admin most needs to find was in no list.
  query('when').optional().isIn(['upcoming', 'now', 'past']),
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
