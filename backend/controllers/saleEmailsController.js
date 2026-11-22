const { sendOk, sendFail } = require('../utils/responseEnvelope');
const notices = require('../services/saleNoticeService');

/**
 * The organizer's sale emails (2026-11-23): every order, a daily summary, or
 * off, and who receives them. services/saleNoticeService.js does the work.
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
  get: run((req) => notices.getSettings(req.user.access.organizerId)),
  save: run((req) => notices.saveSettings(req.user.access.organizerId, req.body)),
};
