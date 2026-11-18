const profiles = require('../services/organizerProfileService');
const mapLooks = require('../services/mapLookService');
const accessTokens = require('../services/accessTokens');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');

/**
 * Organizer public profiles and "Message the organizer" (2026-11-18).
 * See services/organizerProfileService.js.
 */

const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message })
  : next(err));

// GET /public/organizers/:slug
async function publicProfile(req, res, next) {
  try {
    const page = await profiles.bySlug(req.params.slug);
    if (!page) return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That organizer page does not exist.' });
    return sendOk(res, page);
  } catch (err) { return answer(res, err, next); }
}

// POST /public/t/:token/contact — the emailed order link is the proof of a ticket.
async function contactFromTicket(req, res, next) {
  try {
    const orderId = accessTokens.readOrderToken(req.params.token);
    if (!orderId) {
      return sendFail(res, {
        status: 401, error: 'INVALID_TOKEN',
        message: 'That link is not valid any more. Open the newest link in your ticket email.',
      });
    }
    const result = await profiles.messageFromOrder({ orderId, senderName: req.body.name, body: req.body.message });
    if (!result.sent) {
      return sendFail(res, {
        status: 503, error: 'FEATURE_DISABLED',
        message: 'Your message is saved, but email is not reaching the organizer right now. Please try again later.',
      });
    }
    return sendOk(res, result);
  } catch (err) { return answer(res, err, next); }
}

// GET /organizers/public-profile
async function mine(req, res, next) {
  try { return sendOk(res, await profiles.getForOwner(req.user.id)); } catch (err) { return answer(res, err, next); }
}

// PATCH /organizers/public-profile
async function update(req, res, next) {
  try { return sendOk(res, await profiles.updateForOwner(req.user.id, req.body)); } catch (err) { return answer(res, err, next); }
}

// POST /organizers/public-profile/logo-upload
async function logoUpload(req, res, next) {
  try { return sendOk(res, await profiles.signLogo(req.user.id, req.body.contentType)); } catch (err) { return answer(res, err, next); }
}

// PUT /organizers/public-profile/logo  { path } — or { path: null } to remove it
async function setLogo(req, res, next) {
  try { return sendOk(res, await profiles.setLogo(req.user.id, req.body.path || null)); } catch (err) { return answer(res, err, next); }
}

// GET /organizers/map-looks — the organizer's saved seating-map looks
async function listMapLooks(req, res, next) {
  try { return sendOk(res, { looks: await mapLooks.listForOwner(req.user.id) }); } catch (err) { return answer(res, err, next); }
}

// PUT /organizers/map-looks  { looks: [...] } — the whole list to keep
async function saveMapLooks(req, res, next) {
  try { return sendOk(res, { looks: await mapLooks.saveForOwner(req.user.id, req.body.looks) }); } catch (err) { return answer(res, err, next); }
}

module.exports = {
  publicProfile, contactFromTicket, mine, update, logoUpload, setLogo, listMapLooks, saveMapLooks,
};
