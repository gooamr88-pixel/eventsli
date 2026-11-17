const addons = require('../services/addonService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');

/**
 * The organizer's add-ons on an event (2026-11-17): "Photo with the
 * headliner" and the like. The organizer alone delivers them; the screen and
 * the buyer's checkout both say so. See services/addonService.js.
 */
const statusFor = (code) => ERROR_STATUS[code] || 400;
const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message })
  : next(err));

async function list(req, res, next) {
  try { return sendOk(res, await addons.listForOrganizer(req.params.eventId)); } catch (err) { return answer(res, err, next); }
}

async function create(req, res, next) {
  try { return sendOk(res, await addons.create(req.params.eventId, req.body), { status: 201 }); } catch (err) { return answer(res, err, next); }
}

async function update(req, res, next) {
  try { return sendOk(res, await addons.update(req.params.eventId, req.params.addonId, req.body)); } catch (err) { return answer(res, err, next); }
}

async function remove(req, res, next) {
  try { return sendOk(res, await addons.remove(req.params.eventId, req.params.addonId)); } catch (err) { return answer(res, err, next); }
}

module.exports = { list, create, update, remove };
