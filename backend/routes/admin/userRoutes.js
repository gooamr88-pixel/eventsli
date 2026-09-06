const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('../../controllers/admin/userController');

/**
 * BRD §19 — user and organizer administration.
 *
 * A separate router from approvalRoutes, mounted on the same path. Both are
 * admin-only, but "review this event" and "suspend this person" are different
 * jobs with different blast radii, and a single 200-line admin file is where
 * a route quietly ends up guarded by the wrong middleware.
 */
const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get(
  '/users',
  query('role').optional().isIn(['attendee', 'organizer', 'admin', 'super_admin']),
  query('blocked').optional().isIn(['true', 'false']),
  validate,
  c.list,
);

router.get('/users/:userId', param('userId').isUUID(), validate, c.detail);

/**
 * The role ladder is enforced in the controller, not here: whether this is
 * allowed depends on the CALLER's role and on the target's, and a validator
 * that only sees the body cannot know either.
 */
router.patch(
  '/users/:userId/role',
  param('userId').isUUID(),
  body('role').isIn(['attendee', 'organizer', 'admin', 'super_admin'])
    .withMessage('Choose one of: attendee, organizer, admin, super_admin.'),
  validate,
  c.changeRole,
);

// The reason is required and is kept. Someone will ask why this account was
// suspended, months later, and "an admin did it" is not an answer.
router.post(
  '/users/:userId/block',
  param('userId').isUUID(),
  body('reason').isString().trim().isLength({ min: 5, max: 1000 })
    .withMessage('Record why this account is being blocked.'),
  validate,
  c.block,
);

router.post(
  '/users/:userId/unblock',
  param('userId').isUUID(),
  body('reason').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  c.unblock,
);

// ─── Organizers ─────────────────────────────────────────────────────────────
// Banning stops them selling; it does not stop them signing in. See the
// controller for why those are deliberately two different things.
router.post(
  '/organizers/:organizerId/ban',
  param('organizerId').isUUID(),
  body('reason').isString().trim().isLength({ min: 5, max: 1000 })
    .withMessage('Record why this organizer is being suspended.'),
  validate,
  c.banOrganizer,
);

router.post(
  '/organizers/:organizerId/unban',
  param('organizerId').isUUID(),
  body('reason').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  c.unbanOrganizer,
);

module.exports = router;
