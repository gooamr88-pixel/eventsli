const changeRequests = require('../../services/eventChangeRequests');
const { parsePagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Reviewing an organizer's changes to a live event (2026-11-24,
 * services/eventChangeRequests.js). Approving writes them to the event;
 * declining leaves the event as it is and tells the organizer why. Both are
 * on the audit record with the before and after.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fail = (res, err, next) => {
  const status = { NOT_FOUND: 404, CONFLICT: 409, VALIDATION_ERROR: 400 }[err.code];
  return status ? sendFail(res, { status, error: err.code, message: err.message }) : next(err);
};

// GET /admin/change-requests?status=pending|approved|rejected|withdrawn|all
async function list(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });
    const status = ['pending', 'approved', 'rejected', 'withdrawn', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const { rows, count } = await changeRequests.list({ status, from: p.from, to: p.to });
    return sendOk(res, rows, { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

// POST /admin/change-requests/:requestId/approve  { note? }
async function approve(req, res, next) {
  try {
    const result = await changeRequests.approve({
      id: req.params.requestId, adminId: req.user.id, note: req.body.note?.trim() || null,
    });
    await writeAudit(req, {
      action: 'event.change_approved', targetType: 'event', targetId: result.event.id,
      payload: { requestId: req.params.requestId, before: result.before, after: result.after, note: req.body.note || null },
    });
    return sendOk(res, result.request);
  } catch (err) { return fail(res, err, next); }
}

// POST /admin/change-requests/:requestId/reject  { note }
async function reject(req, res, next) {
  try {
    const request = await changeRequests.reject({
      id: req.params.requestId, adminId: req.user.id, note: req.body.note.trim(),
    });
    await writeAudit(req, {
      action: 'event.change_declined', targetType: 'event', targetId: request.eventId,
      payload: { requestId: req.params.requestId, note: req.body.note },
    });
    return sendOk(res, request);
  } catch (err) { return fail(res, err, next); }
}

module.exports = { list, approve, reject };
