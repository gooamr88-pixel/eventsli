const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');

/**
 * Everything under /api/v1/admin, behind ONE guard.
 *
 * The three admin routers each ran `router.use(requireAuth, requireRole('admin'))`
 * and all three were mounted on the same path, so a request for a route in the
 * third router authenticated three times — three session lookups and three
 * session touches per call.
 *
 * The routers below therefore carry no guard of their own. They must only ever
 * be mounted through this file; mounting one directly would expose it.
 */
const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.use(require('./approvalRoutes'));
router.use(require('./userRoutes'));
router.use(require('./insightRoutes'));
router.use(require('./storefrontRoutes'));

module.exports = router;
