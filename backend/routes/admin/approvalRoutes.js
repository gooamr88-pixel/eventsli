const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const c = require('../../controllers/admin/approvalController');

// Guarded by routes/admin/index.js (requireAuth + admin). Mount it only there.
const router = express.Router();

router.get('/approvals', c.queue);

router.post(
  '/events/:eventId/approve',
  param('eventId').isUUID(),
  validate,
  c.approve,
);

router.post(
  '/events/:eventId/reject',
  param('eventId').isUUID(),
  // BRD §16 — the reason is REQUIRED and is shown to the organizer. A rejection
  // they cannot act on just becomes a support ticket, which is the thing this
  // whole review loop exists to avoid.
  body('reason').isString().trim().isLength({ min: 10, max: 2000 })
    .withMessage('Explain what needs to change — the organizer will see this.'),
  validate,
  c.reject,
);

router.post(
  '/events/:eventId/suspend',
  param('eventId').isUUID(),
  body('reason').isString().trim().isLength({ min: 10, max: 2000 })
    .withMessage('Record why this event is being suspended.'),
  validate,
  c.suspend,
);

router.post(
  '/events/:eventId/unsuspend',
  param('eventId').isUUID(),
  validate,
  c.unsuspend,
);

// BRD §17 — only an admin cancels. It is terminal, so the reason is required
// and goes into the audit trail with it.
router.post(
  '/events/:eventId/cancel',
  param('eventId').isUUID(),
  body('reason').isString().trim().isLength({ min: 10, max: 1000 })
    .withMessage('Record why this event is being cancelled.'),
  validate,
  c.cancel,
);

// ─── Cancellation requests from organizers ─────────────────────────────────
// Listed for any admin; DECIDED by a super admin, because approving one is a
// cancellation — terminal, and on the organizer's word.
router.get(
  '/cancellation-requests',
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'withdrawn', 'all']),
  validate,
  c.cancellationRequests,
);
router.post(
  '/cancellation-requests/:requestId/approve',
  requireRole('super_admin'),
  param('requestId').isUUID(),
  body('note').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  c.approveCancellation,
);
router.post(
  '/cancellation-requests/:requestId/reject',
  requireRole('super_admin'),
  param('requestId').isUUID(),
  body('note').isString().trim().isLength({ min: 10, max: 2000 })
    .withMessage('Tell the organizer why — they will see this.'),
  validate,
  c.rejectCancellation,
);

// BRD 18 - a super admin can reopen a gate that an overdue invoice closed.
// Time-boxed: a permanent override is a lock quietly removed.
router.post(
  '/events/:eventId/scanner-override',
  requireRole('super_admin'),
  param('eventId').isUUID(),
  body('hours').optional().isInt({ min: 1, max: 72 }),
  body('reason').isString().trim().isLength({ min: 5, max: 500 })
    .withMessage('Record why the gate is being reopened.'),
  validate,
  require('../../controllers/scanController').override,
);

// Ends an override early; the gate goes back to what the invoices say.
router.post(
  '/events/:eventId/scanner-override/end',
  requireRole('super_admin'),
  param('eventId').isUUID(),
  body('reason').isString().trim().isLength({ min: 5, max: 500 })
    .withMessage('Record why the override is ending early.'),
  validate,
  require('../../controllers/scanController').endOverride,
);

// ─── Commission invoices (BRD §18, §20) ────────────────────────────────────
const manual = require('../../controllers/manualPaymentController');

router.get('/invoices', manual.adminList);

router.post(
  '/events/:eventId/invoices',
  param('eventId').isUUID(),
  validate,
  manual.adminRaise,
);

// Settling is what reopens the gate — not a separate unlock, because the lock
// is derived from the outstanding balance rather than stored beside it. So this
// is the one place "we saw the money" is recorded, and it is admin-only.
router.post(
  '/invoices/:invoiceId/settle',
  param('invoiceId').isUUID(),
  body('note').optional().isString().trim().isLength({ max: 500 }),
  validate,
  manual.adminSettle,
);

// ─── BRD §19 — the settings only an admin may set ──────────────────────────
const settings = require('../../controllers/admin/settingsController');

/**
 * The commission, tax and payment fee are admin-only (BRD §05, §06). This is
 * the other side of the rule `eventRules.partitionPatch` enforces on the
 * organizer's endpoint, and it reuses the SAME map rather than keeping a second
 * list that can drift out of step.
 */
router.patch(
  '/events/:eventId/fees',
  param('eventId').isUUID(),
  body('commissionPct').optional().isFloat({ min: 0, max: 100 }),
  body('commissionTaxPct').optional().isFloat({ min: 0, max: 100 }),
  body('eventTaxPct').optional().isFloat({ min: 0, max: 100 }),
  body('paymentFeePct').optional().isFloat({ min: 0, max: 100 }),
  body('paymentFeeFixedCents').optional().isInt({ min: 0 }),
  body('paymentFeeMode').optional().isIn(['auto', 'manual']),
  // Kept in the audit log beside the old and new rates.
  body('reason').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  settings.updateEventFees,
);

// What a configuration actually earns, priced across a range — so an admin can
// see it BEFORE saving rather than in next month's total.
router.get('/events/:eventId/fees/preview', param('eventId').isUUID(), validate, settings.previewFees);

router.get('/settings', settings.getSettings);
router.patch(
  '/settings/:key',
  requireRole('super_admin'),
  body('value').exists().withMessage('Send the new value.'),
  // The shape of `value` is checked per key in the controller (utils/settingsSchema.js).
  body('reason').isString().trim().isLength({ min: 5, max: 500 })
    .withMessage('Record why this setting is changing.'),
  validate,
  settings.updateSettings,
);

router.get('/audit', settings.auditLog);

module.exports = router;