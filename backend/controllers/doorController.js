const door = require('../services/doorService');
const qrSigning = require('../services/qrSigning');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * The check-in app's reads at the door (behind requireDevice), and the
 * organizer's door settings (behind verifyEventOwner). Permissions live in
 * services/doorService.js.
 */

const GUESTS_OFF = {
  status: 403, error: 'FORBIDDEN',
  message: 'The organizer has not shared the guest list with the door team.',
};

// ═══ DEVICE ══════════════════════════════════════════════════════════════════

// GET /scan/me
async function me(req, res, next) {
  try {
    return sendOk(res, await door.me(req.device));
  } catch (err) { return next(err); }
}

// GET /scan/recent
async function recent(req, res, next) {
  try {
    return sendOk(res, await door.recent(req.device, {
      limit: Number(req.query.limit) || 20,
      before: req.query.before || null,
      admittedOnly: req.query.kind !== 'all',
    }));
  } catch (err) { return next(err); }
}

// GET /scan/attendees
async function attendees(req, res, next) {
  try {
    const list = await door.attendees(req.device, {
      q: req.query.q || '',
      status: req.query.status || 'all',
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    if (!list) return sendFail(res, GUESTS_OFF);
    return sendOk(res, list.rows, {
      pagination: {
        total: list.total, limit: list.limit, offset: list.offset,
        hasMore: list.offset + list.rows.length < list.total,
      },
    });
  } catch (err) { return next(err); }
}

// GET /scan/tickets/:ticketId
async function ticket(req, res, next) {
  try {
    const data = await door.ticket(req.device, req.params.ticketId);
    // 404 for a ticket at another event as for no ticket: a device has no
    // business learning which ids exist elsewhere.
    if (!data) {
      return sendFail(res, { status: 404, error: 'TICKET_NOT_FOUND', message: 'That ticket is not for this event.' });
    }
    return sendOk(res, data);
  } catch (err) { return next(err); }
}

// POST /scan/manual-check-in
async function manualCheckIn(req, res, next) {
  try {
    const result = await door.manualCheckIn(req.device, {
      ticketId: req.body.ticketId, clientScanId: req.body.clientScanId,
    });
    if (result.forbidden) return sendFail(res, GUESTS_OFF);
    if (result.unavailable) {
      // The database did not answer. A 503, never a 200 'error': the door holds
      // the scan (or decides it from its offline list) and nobody is turned away
      // or let in on a non-answer.
      return sendFail(res, {
        status: 503, error: 'SCAN_UNAVAILABLE',
        message: 'The check-in server is busy. The scan is kept and checked again in a moment.',
      });
    }
    // Same contract as /scan/verify: every decided outcome is a 200, and only a
    // locked gate — which the door cannot resolve — is an error.
    if (result.result === 'scanner_locked') {
      return sendFail(res, {
        status: 403, error: 'SCANNER_LOCKED', message: result.message, meta: { reason: result.reason },
      });
    }
    if (result.result === 'admitted') {
      logger.info({ deviceId: req.device.deviceId, ticketId: req.body.ticketId }, 'manual check-in');
    }
    return sendOk(res, result);
  } catch (err) { return next(err); }
}

// GET /scan/analytics
async function analytics(req, res, next) {
  try {
    return sendOk(res, await door.analytics(req.device, {
      bucketMinutes: Number(req.query.bucket) || 15,
    }));
  } catch (err) { return next(err); }
}

// ═══ ORGANIZER ═══════════════════════════════════════════════════════════════

// GET /events/:eventId/gate-settings
async function getSettings(req, res, next) {
  try {
    return sendOk(res, await door.getSettings(req.params.eventId));
  } catch (err) { return next(err); }
}

// PATCH /events/:eventId/gate-settings
async function updateSettings(req, res, next) {
  try {
    const saved = await door.updateSettings(req.params.eventId, req.body, req.user.id);
    logger.info({ eventId: req.params.eventId, userId: req.user.id, settings: saved }, 'door settings changed');
    return sendOk(res, saved);
  } catch (err) { return next(err); }
}

// GET /scan/manifest — the event's tickets, for deciding with no signal.
async function manifest(req, res, next) {
  try {
    const data = await door.manifest(req.device, {
      cursor: req.query.cursor || null,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    if (data.off) {
      // The phone deletes its copy on this answer: the organizer took it back.
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN',
        message: 'The organizer has switched off offline check-in for this event.',
        meta: { reason: 'offline_admission_off' },
      });
    }
    return sendOk(res, data);
  } catch (err) { return next(err); }
}

// GET /scan/keys — the public keys that verify QR v2 codes on the device.
async function keys(req, res, next) {
  try {
    return sendOk(res, { keys: qrSigning.jwks() });
  } catch (err) { return next(err); }
}

module.exports = {
  me, recent, attendees, ticket, manualCheckIn, analytics, manifest, keys,
  getSettings, updateSettings,
};
