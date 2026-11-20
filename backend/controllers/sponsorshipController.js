const S = require('../services/sponsorshipService');
const portal = require('../services/sponsorPortalService');
const { frontendOrigin } = require('../utils/frontendOrigin');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');

/**
 * Sponsorships (2026-11-20): the organizer's pipeline, the sponsor portal and
 * the public "Become a sponsor" page. Translation only — every rule is in
 * services/sponsorshipService.js, services/sponsorPortalService.js and the
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

// ── Organizer: /events/:eventId/sponsorship/… ─────────────────────────────
const organizer = {
  getProgram: run((req) => S.getProgram(req.params.eventId)),
  saveProgram: run((req) => S.saveProgram(req.params.eventId, req.body)),
  listPackages: run((req) => S.listPackages(req.params.eventId)),
  createPackage: run((req) => S.createPackage(req.params.eventId, req.body), { status: 201 }),
  updatePackage: run((req) => S.updatePackage(req.params.eventId, req.params.packageId, req.body)),
  removePackage: run((req) => S.removePackage(req.params.eventId, req.params.packageId)),
  listDeals: run((req) => S.listDeals(req.params.eventId)),
  getDeal: run((req) => S.getDeal(req.params.eventId, req.params.dealId)),
  createDeal: run((req) => S.createDeal(req.params.eventId, req.body, actor(req)), { status: 201 }),
  updateDeal: run((req) => S.updateDeal(req.params.eventId, req.params.dealId, req.body)),
  sendProposal: run((req) => S.sendProposal(req.params.eventId, req.params.dealId, req.body, actor(req))),
  recordPayment: run((req) => S.recordOfflinePayment(
    req.params.eventId, req.params.dealId, req.params.installmentId, req.body, actor(req),
  )),
  close: run((req) => S.closeDeal(req.params.eventId, req.params.dealId, req.body.outcome, req.body.reason, actor(req))),
  reopen: run((req) => S.reopenDeal(req.params.eventId, req.params.dealId, actor(req))),
  signLogoUpload: run((req) => S.signLogoUpload(req.params.eventId, req.body.contentType)),
  confirmLogo: run((req) => S.confirmLogo(req.params.eventId, req.body.path)),
};

// ── Sponsor portal: /partner/sponsorships/… ───────────────────────────────
const partner = {
  list: run((req) => portal.listForUser(req.user)),
  get: run((req) => portal.getForUser(req.user, req.params.dealId)),
  sign: run((req) => portal.sign(req.user, req.params.dealId, req.body, req)),
  updateBrand: run((req) => portal.updateBrand(req.user, req.params.dealId, req.body)),
  signLogoUpload: run((req) => portal.signLogoUpload(req.user, req.params.dealId, req.body.contentType)),
  confirmLogo: run((req) => portal.confirmLogo(req.user, req.params.dealId, req.body.path)),
  pay: run((req) => portal.startCardPayment(
    req.user, req.params.dealId, req.params.installmentId, frontendOrigin(req.headers.origin),
  )),
};

// ── Public: /public/events/:slug/sponsorship ──────────────────────────────
const publicPage = {
  page: run((req) => portal.publicPage(req.params.slug)),
  inquire: run((req) => portal.submitInquiry(req.params.slug, req.body), { status: 201 }),
};

module.exports = { organizer, partner, publicPage };
