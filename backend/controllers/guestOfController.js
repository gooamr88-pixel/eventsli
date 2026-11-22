const { sendOk, sendFail } = require('../utils/responseEnvelope');
const guestOf = require('../services/guestOfService');

/**
 * Whose guest a buyer is (2026-11-23) — the organizer's hosts, and each host's
 * private guest list. The work is in services/guestOfService.js; the routes
 * have already run `verifyEventOwner` for everything but `publicList`.
 */
function run(handler) {
  return async (req, res, next) => {
    try {
      return sendOk(res, await handler(req));
    } catch (err) {
      if (err.code && err.status) return sendFail(res, { status: err.status, error: err.code, message: err.message });
      return next(err);
    }
  };
}

module.exports = {
  overview: run((req) => guestOf.overview(req.params.eventId)),
  saveSettings: run((req) => guestOf.saveSettings(req.params.eventId, req.body)),
  create: run((req) => guestOf.createHost(req.params.eventId, req.body)),
  update: run((req) => guestOf.updateHost(req.params.eventId, req.params.hostId, req.body)),
  remove: run((req) => guestOf.removeHost(req.params.eventId, req.params.hostId)),
  resetLink: run((req) => guestOf.resetLink(req.params.eventId, req.params.hostId)),
  guests: run((req) => guestOf.guestsOf(req.params.eventId, req.params.hostId)),
  // Public, by the link's own signature: no account, nothing cached.
  publicList: async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex');
    return run((r) => guestOf.guestListByToken(r.params.token))(req, res, next);
  },
};
