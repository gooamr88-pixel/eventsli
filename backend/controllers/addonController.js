const addons = require('../services/addonService');
const media = require('../services/mediaService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * The organizer's add-ons on an event (2026-11-17): "Photo with the
 * headliner" and the like. The organizer alone delivers them; the screen and
 * the buyer's checkout both say so. See services/addonService.js.
 */
const statusFor = (code) => ERROR_STATUS[code] || 400;
const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message })
  : next(err));

/**
 * THE EVENT PAGE SHOWS THE EXTRAS (2026-11-22), and it is cached per event
 * (tag `event:<slug>`). Without this, a new extra appeared on the checkout —
 * which is never cached — while the event page still said there were none
 * (owner, 2026-11-22). Never throws: the change is already saved.
 */
async function refreshEventPage(eventId) {
  try {
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventId).maybeSingle();
    if (ev?.slug) await require('../services/revalidateService').revalidate([`event:${ev.slug}`]);
  } catch (err) {
    logger.warn({ err: err.message, eventId }, 'add-ons: event page refresh failed');
  }
}

async function list(req, res, next) {
  try { return sendOk(res, await addons.listForOrganizer(req.params.eventId)); } catch (err) { return answer(res, err, next); }
}

async function create(req, res, next) {
  try {
    const row = await addons.create(req.params.eventId, req.body);
    await refreshEventPage(req.params.eventId);
    return sendOk(res, row, { status: 201 });
  } catch (err) { return answer(res, err, next); }
}

async function update(req, res, next) {
  try {
    const row = await addons.update(req.params.eventId, req.params.addonId, req.body);
    await refreshEventPage(req.params.eventId);
    return sendOk(res, row);
  } catch (err) { return answer(res, err, next); }
}

async function remove(req, res, next) {
  try {
    const result = await addons.remove(req.params.eventId, req.params.addonId);
    await refreshEventPage(req.params.eventId);
    return sendOk(res, result);
  } catch (err) { return answer(res, err, next); }
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
