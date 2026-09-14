const share = require('../services/shareService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

// GET /events/:eventId/share
async function info(req, res, next) {
  try {
    const data = await share.shareInfo(req.params.eventId);
    if (!data) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    return sendOk(res, data);
  } catch (err) { return next(err); }
}

// GET /events/:eventId/share/qr.png[?tier=<id>][&size=lg][&download=1]
/**
 * The URL encoded is decided on the server from the event's slug; the request
 * can only NAME a tier, and a tier that is not this event's is refused rather
 * than quietly replaced with the event link.
 */
async function qr(req, res, next) {
  try {
    const target = await share.resolveTarget(req.params.eventId, req.query.tier || null);
    if (!target) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND', message: 'That ticket type is not part of this event.',
      });
    }

    const png = await share.renderPng(target.url, req.query.size);
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      // A public link, not a credential — but still the organizer's dashboard.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ...(req.query.download === '1'
        ? { 'Content-Disposition': `attachment; filename="${target.filename}"` }
        : {}),
    });
    return res.end(png);
  } catch (err) { return next(err); }
}

module.exports = { info, qr };
