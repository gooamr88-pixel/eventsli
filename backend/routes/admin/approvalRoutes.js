const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const c = require('../../controllers/admin/approvalController');
const { auditListRules, invoiceListRules } = require('./listRules');

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

// The gate control: follow invoices (auto), keep open, or keep closed —
// optionally until a time. Super admin, like the override it generalises
// (BRD §18): it decides whether people get in, regardless of what is owed.
router.post(
  '/events/:eventId/gate',
  requireRole('super_admin'),
  param('eventId').isUUID(),
  body('mode').isIn(['auto', 'open', 'closed']).withMessage('Choose follow invoices, keep open, or keep closed.'),
  body('until').optional({ values: 'null' }).isISO8601().withMessage('The end time must be a date and time.'),
  body('reason').isString().trim().isLength({ min: 5, max: 500 })
    .withMessage('Record why the gate is changing.'),
  body('notify').optional().isBoolean(),
  validate,
  require('../../controllers/scanController').setGateMode,
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

router.get('/invoices', ...invoiceListRules, validate, manual.adminList);
// What is owed and not yet invoiced — the queue the console raises from.
router.get('/invoices/ready', manual.adminReady);

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

/**
 * ─── Managing one invoice ──────────────────────────────────────────────────
 * Every action below is one database function (migration 20261115090000):
 * atomic, recorded in the invoice's history and the audit log, and — where it
 * moves money — in the ledger as a new row, never an edit. Those that change
 * what the organizer owes require a reason, which the organizer is shown.
 */
const reason = (min = 5) => body('reason').isString().trim().isLength({ min, max: 500 })
  .withMessage(`Give a reason (at least ${min} characters) — it is recorded${min >= 5 ? ' and shown to the organizer' : ''}.`);
const invoiceParam = param('invoiceId').isUUID();

router.get('/invoices/:invoiceId', invoiceParam, validate, manual.adminDetail);

router.post(
  '/invoices/:invoiceId/payments',
  invoiceParam,
  body('amountCents').isInt({ min: 1, max: 100_000_000 }).withMessage('Enter the amount that arrived, in cents.'),
  body('method').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 60 }),
  body('reference').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
  body('receivedAt').optional({ values: 'falsy' }).isISO8601().withMessage('Enter when the money arrived.'),
  body('note').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
  body('notify').optional().isBoolean(),
  validate,
  manual.adminRecordPayment,
);

router.post(
  '/invoices/:invoiceId/payments/:paymentId/reverse',
  invoiceParam,
  param('paymentId').isUUID(),
  reason(),
  validate,
  manual.adminReversePayment,
);

router.post('/invoices/:invoiceId/waive', invoiceParam, reason(), validate, manual.adminWaive);
router.post('/invoices/:invoiceId/reopen', invoiceParam, reason(), validate, manual.adminReopen);
router.post('/invoices/:invoiceId/void', invoiceParam, reason(), validate, manual.adminVoid);
router.post('/invoices/:invoiceId/reject-receipt', invoiceParam, reason(), validate, manual.adminRejectReceipt);

router.post(
  '/invoices/:invoiceId/due-date',
  invoiceParam,
  body('dueAt').isISO8601().withMessage('Choose the new due date.'),
  reason(),
  validate,
  manual.adminSetDue,
);

router.post(
  '/invoices/:invoiceId/notes',
  invoiceParam,
  body('note').isString().trim().isLength({ min: 2, max: 1000 }).withMessage('Write the note (up to 1,000 characters).'),
  validate,
  manual.adminNote,
);

router.post('/invoices/:invoiceId/remind', invoiceParam, validate, manual.adminRemind);

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

// `?since=` (an ISO date-time) counts a recent window — see listRules.js.
router.get('/audit', ...auditListRules, validate, settings.auditLog);

module.exports = router;