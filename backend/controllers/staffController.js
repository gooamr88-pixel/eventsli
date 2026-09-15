const staff = require('../services/staffService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

// ═══ ORGANIZER — managing the door team ═════════════════════════════════════

// GET /events/:eventId/staff
async function list(req, res, next) {
  try {
    return sendOk(res, await staff.list(req.params.eventId));
  } catch (err) { return next(err); }
}

// POST /events/:eventId/staff
/**
 * The same answer whether or not the address has an account, and no name.
 *
 * It used to be a 404 for an unknown email and a 201 carrying the person's
 * name for a known one — and anyone can create an organizer profile — so this
 * was a free way to learn who uses Eventsli. The route is also rate limited
 * per organizer. What is left is the door-team list itself, which shows only
 * the addresses the organizer typed.
 */
async function add(req, res, next) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const result = await staff.add({ eventId: req.params.eventId, email, addedBy: req.user.id });
    logger.info({ eventId: req.params.eventId, by: req.user.id, added: result.added }, 'door team add requested');
    return sendOk(res, {
      email,
      message: 'If that address belongs to an Eventsli account, they are on the door team and we have emailed them how to sign in.',
    }, { status: 202 });
  } catch (err) {
    return next(err);
  }
}

// DELETE /events/:eventId/staff/:staffId
async function revoke(req, res, next) {
  try {
    const done = await staff.revoke({ eventId: req.params.eventId, staffId: req.params.staffId });
    if (!done) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That person is not on this door team.' });
    }
    logger.info({ eventId: req.params.eventId, staffId: req.params.staffId, by: req.user.id },
      'door team member removed');
    return sendOk(res, { id: req.params.staffId, active: false });
  } catch (err) { return next(err); }
}

// ═══ DOOR TEAM MEMBER — at the gate ═════════════════════════════════════════

// GET /scan/assignments
async function assignments(req, res, next) {
  try {
    return sendOk(res, await staff.assignmentsFor({
      userId: req.user.id, organizerId: req.user.access.organizerId,
    }));
  } catch (err) { return next(err); }
}

// POST /scan/staff-login
/**
 * One refusal for every reason — not on the team, removed, no such event, event
 * not on sale — so the endpoint cannot be used to learn which event ids exist
 * or who works which door.
 */
async function staffLogin(req, res, next) {
  try {
    const session = await staff.openStaffSession({
      userId: req.user.id,
      organizerId: req.user.access.organizerId,
      displayName: req.user.access.fullName || req.user.email,
      eventId: req.body.eventId,
    });
    if (!session) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN',
        message: 'You are not on the door team for that event, or it is not open for scanning.',
      });
    }
    logger.info({ eventId: req.body.eventId, userId: req.user.id }, 'door team member signed in to scan');
    return sendOk(res, session);
  } catch (err) { return next(err); }
}

module.exports = { list, add, revoke, assignments, staffLogin };
