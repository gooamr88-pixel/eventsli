const V = require('../services/vendorService');
const portal = require('../services/vendorPortalService');
const booking = require('../services/vendorBookingService');
const { frontendOrigin } = require('../utils/frontendOrigin');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');

/**
 * Vendors (2026-11-20): the organizer's applications board, the vendor portal
 * and the public vendor page. Translation only — the rules are in
 * services/vendorService.js, services/vendorPortalService.js and the
 * migration's functions.
 */
const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message })
  : next(err));

const run = (fn, { status = 200 } = {}) => async (req, res, next) => {
  try {
    return sendOk(res, await fn(req), { status });
  } catch (err) {
    return answer(res, err, next);
  }
};
const actor = (req) => req.user?.id || null;
const ev = (req) => req.params.eventId;

const organizer = {
  getProgram: run((req) => V.getProgram(ev(req))),
  saveProgram: run((req) => V.saveProgram(ev(req), req.body)),
  listBooths: run((req) => V.listBooths(ev(req))),
  createBooth: run((req) => V.createBooth(ev(req), req.body), { status: 201 }),
  updateBooth: run((req) => V.updateBooth(ev(req), req.params.boothId, req.body)),
  removeBooth: run((req) => V.removeBooth(ev(req), req.params.boothId)),
  list: run((req) => V.listApplications(ev(req))),
  get: run((req) => V.getApplication(ev(req), req.params.appId)),
  create: run((req) => V.createApplication(ev(req), req.body, actor(req)), { status: 201 }),
  update: run((req) => V.updateApplication(ev(req), req.params.appId, req.body)),
  waitlist: run((req) => V.setWaitlist(ev(req), req.params.appId, req.body.waitlisted !== false, actor(req))),
  offer: run((req) => V.sendOffer(ev(req), req.params.appId, req.body, actor(req))),
  recordPayment: run((req) => V.recordOfflinePayment(ev(req), req.params.appId, req.body, actor(req))),
  close: run((req) => V.close(ev(req), req.params.appId, req.body.outcome, req.body.reason, actor(req))),
  doorList: run((req) => V.doorList(ev(req))),
  getFloorPlan: run((req) => V.getFloorPlan(ev(req))),
  saveFloorPlan: run((req) => V.saveFloorPlan(ev(req), req.body, actor(req))),
  signLogoUpload: run((req) => V.signLogoUpload(ev(req), req.body.contentType)),
  confirmLogo: run((req) => V.confirmLogo(ev(req), req.body.path)),
  listAddons: run((req) => booking.listAddons(ev(req))),
  createAddon: run((req) => booking.createAddon(ev(req), req.body), { status: 201 }),
  updateAddon: run((req) => booking.updateAddon(ev(req), req.params.addonId, req.body)),
  removeAddon: run((req) => booking.removeAddon(ev(req), req.params.addonId)),
  documentUrl: run((req) => booking.organizerDocumentUrl(ev(req), req.params.appId, req.params.docId)),
  reviewDocument: run((req) => booking.reviewDocument(ev(req), req.params.appId, req.params.docId, req.body, actor(req))),
};

const vendor = {
  list: run((req) => portal.listForUser(req.user)),
  get: run((req) => portal.getForUser(req.user, req.params.appId)),
  accept: run((req) => portal.accept(req.user, req.params.appId, req.body, req)),
  withdraw: run((req) => portal.withdraw(req.user, req.params.appId, req.body.reason)),
  update: run((req) => portal.updateProfile(req.user, req.params.appId, req.body)),
  signLogoUpload: run((req) => portal.signLogoUpload(req.user, req.params.appId, req.body.contentType)),
  confirmLogo: run((req) => portal.confirmLogo(req.user, req.params.appId, req.body.path)),
  pay: run((req) => portal.startCardPayment(req.user, req.params.appId, frontendOrigin(req.headers.origin))),
};

/** The booking flow (2026-11-21). */
const bookingFlow = {
  start: run((req) => booking.start(req.user, req.body.slug, req.body), { status: 201 }),
  get: run((req) => booking.getBooking(req.user, req.params.appId)),
  save: run((req) => booking.saveDetails(req.user, req.params.appId, req.body)),
  signDocument: run((req) => booking.signDocument(req.user, req.params.appId, req.params.docId, req.body.contentType)),
  confirmDocument: run((req) => booking.confirmDocument(req.user, req.params.appId, req.params.docId, req.body)),
  removeDocument: run((req) => booking.removeDocument(req.user, req.params.appId, req.params.docId)),
  documentUrl: run((req) => booking.vendorDocumentUrl(req.user, req.params.appId, req.params.docId)),
  submit: run((req) => booking.submit(req.user, req.params.appId)),
  release: run((req) => booking.release(req.user, req.params.appId)),
  checkout: run((req) => booking.checkout(req.user, req.params.appId, req.body, req, frontendOrigin(req.headers.origin))),
};

const publicPage = {
  page: run((req) => portal.publicPage(req.params.slug)),
  apply: run((req) => portal.apply(req.params.slug, req.body), { status: 201 }),
};

module.exports = { organizer, vendor, publicPage, booking: bookingFlow };
