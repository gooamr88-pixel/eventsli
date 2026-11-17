const addons = require('../services/addonService');
const media = require('../services/mediaService');
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

/** POST /events/:eventId/addons/image-upload — a signed URL for the picture. */
async function signImageUpload(req, res, next) {
  try {
    return sendOk(res, await media.signUpload({
      eventId: req.params.eventId,
      contentType: String(req.body.contentType || '').toLowerCase(),
      kind: 'addon',
    }));
  } catch (err) { return answer(res, err, next); }
}

/** POST /events/:eventId/addons/image — the upload landed; its URL to preview. */
async function confirmImage(req, res, next) {
  try {
    if (!addons.ownAddonImage(req.params.eventId, req.body.path)) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'That image does not belong to this event.' });
    }
    return sendOk(res, await media.attach({ eventId: req.params.eventId, path: req.body.path }));
  } catch (err) { return answer(res, err, next); }
}

module.exports = { list, create, update, remove, signImageUpload, confirmImage };
