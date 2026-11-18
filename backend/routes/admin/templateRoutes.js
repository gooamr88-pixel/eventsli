const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const c = require('../../controllers/eventTemplateController');

/**
 * Eventsli's event templates (2026-11-19), under the admin guard in
 * routes/admin/index.js. Mount it only there.
 *
 * READS FOR EVERY ADMIN, WRITES FOR A SUPER ADMIN, by method at router level
 * like the storefront: a template published here is offered to every
 * organizer on the platform.
 */
const router = express.Router();

const superAdmin = requireRole('super_admin');
router.use('/templates', (req, res, next) => (
  req.method === 'GET' || req.method === 'HEAD' ? next() : superAdmin(req, res, next)
));

router.get(
  '/templates',
  query('scope').optional().isIn(['platform', 'organizer']),
  query('q').optional().isString().isLength({ max: 80 }),
  validate,
  c.adminList,
);
router.get('/templates/:id', param('id').isUUID(), validate, c.adminGet);
router.post(
  '/templates',
  body('eventId').isUUID().withMessage('Choose the event to make the template from.'),
  body('name').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 60 }),
  validate,
  c.adminCreate,
);
router.post('/templates/:id/promote', param('id').isUUID(), validate, c.adminPromote);
router.post('/templates/:id/refresh', param('id').isUUID(), validate, c.adminRefresh);
router.patch(
  '/templates/:id',
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 60 }),
  body('status').optional().isIn(['draft', 'published', 'hidden']),
  body('featured').optional().isBoolean({ strict: true }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('coverUrl').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  validate,
  c.adminUpdate,
);
router.delete('/templates/:id', param('id').isUUID(), validate, c.adminRemove);

module.exports = router;
