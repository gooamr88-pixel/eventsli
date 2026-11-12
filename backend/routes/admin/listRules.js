const { query } = require('express-validator');

/**
 * Query-string rules for two admin lists, kept apart from the router so the
 * tests can run them against a bare request (test/adminListRules.test.js) —
 * the router itself needs the database to load.
 *
 * Every value here reaches a PostgREST filter, so each is checked for SHAPE
 * before the controller sees it: a malformed `since` is a 400 with a sentence,
 * never a database error, and `organizerId` can only ever be a UUID.
 */

// GET /admin/audit — `since` counts a recent window: the review queue's
// "approved / rejected in the last 30 days" figures read `pagination.total`.
const auditListRules = [
  query('since').optional().isISO8601().withMessage('since must be an ISO 8601 date.'),
];

// GET /admin/invoices — the filters over the commission invoice list.
const invoiceListRules = [
  // An unknown status reached the database as an enum cast error — a 500.
  query('status').optional().isIn(['open', 'submitted', 'overdue', 'unpaid', 'paid', 'waived', 'void'])
    .withMessage('status must be open, submitted, overdue, unpaid, paid, waived or void.'),
  query('eventId').optional().isUUID().withMessage('eventId must be a UUID.'),
  query('organizerId').optional().isUUID().withMessage('organizerId must be a UUID.'),
  query('issuedSince').optional().isISO8601().withMessage('issuedSince must be an ISO 8601 date.'),
  query('q').optional().isString().isLength({ max: 200 }).withMessage('Search is at most 200 characters.'),
];

module.exports = { auditListRules, invoiceListRules };
