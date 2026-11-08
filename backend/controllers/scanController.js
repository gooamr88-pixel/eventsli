const QRCode = require('qrcode');
const { supabase } = require('../config/supabase');
const scanSvc = require('../services/scanService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');
const { hashIp } = require('../utils/crypto');

// ═══ ORGANIZER — managing the gate ══════════════════════════════════════════

// POST /events/:eventId/scan-devices
async function createDevice(req, res, next) {
  try {
    const device = await scanSvc.registerDevice({
      eventId: req.params.eventId,
      label: req.body.label,
      pin: req.body.pin,
    });
    // The PIN is echoed back ONCE, here, because the organizer has to give it
    // to the door staff and we store only its hash — there is no second chance
    // to read it.
    return sendOk(res, { ...device, pin: req.body.pin }, { status: 201 });
  } catch (err) { return next(err); }
}

// GET /events/:eventId/scan-devices
async function listDevices(req, res, next) {
  try {
    return sendOk(res, await scanSvc.listDevices(req.params.eventId));
  } catch (err) { return next(err); }
}

// PATCH /events/:eventId/scan-devices/:deviceId
async function updateDevice(req, res, next) {
  try {
    // Scoped to the event in the URL, which verifyEventOwner has already
    // checked. Without it, a valid organizer could revoke another organizer's
    // device by id.
    const { data: owned } = await supabase
      .from('scan_devices').select('id')
      .eq('id', req.params.deviceId).eq('event_id', req.params.eventId).maybeSingle();

    if (!owned) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such device.' });
    }
    return sendOk(res, await scanSvc.setDeviceActive(req.params.deviceId, !!req.body.isActive));
  } catch (err) { return next(err); }
}

// GET /events/:eventId/gate
async function gateStatus(req, res, next) {
  try {
    return sendOk(res, await scanSvc.gateStatus(req.params.eventId));
  } catch (err) { return next(err); }
}

// GET /events/:eventId/scan-devices/:deviceId/pairing.png
/**
 * A QR the check-in app scans to fill in a shared device's id — 36 characters
 * nobody should have to type on a phone at a door.
 *
 * It carries the device id and NOTHING ELSE. The id is not secret (it is
 * listed on this page with a copy button); the PIN is, and it is never in the
 * code. A photo of this QR is still useless without the PIN.
 */
async function pairingQr(req, res, next) {
  try {
    const { data: owned } = await supabase
      .from('scan_devices').select('id')
      .eq('id', req.params.deviceId).eq('event_id', req.params.eventId)
      .is('staff_id', null)
      .maybeSingle();
    if (!owned) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such device.' });
    }
    const link = `eventsli-checkin://pair?device=${encodeURIComponent(owned.id)}`;
    const png = await QRCode.toBuffer(link, {
      type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 320,
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, no-store');
    return res.send(png);
  } catch (err) { return next(err); }
}

// ═══ DEVICE — at the door ═══════════════════════════════════════════════════

// POST /scan/login
async function deviceLogin(req, res, next) {
  try {
    const result = await scanSvc.authenticateDevice({
      deviceId: req.body.deviceId, pin: req.body.pin,
    });
    if (!result) {
      // Hashed like every stored address (utils/crypto.hashIp): still enough to
      // correlate repeated failures, no longer a raw IP in the log.
      logger.warn({ deviceId: req.body.deviceId, ipHash: hashIp(req.ip) }, 'device login failed');
      return sendFail(res, {
        status: 401, error: 'UNAUTHENTICATED',
        // The same sentence for a wrong PIN, a revoked device and a locked one.
        message: 'That device ID or PIN is not right. After 10 wrong PINs a device waits 15 minutes before it can try again.',
      });
    }
    return sendOk(res, result);
  } catch (err) { return next(err); }
}

// POST /scan/verify
async function verify(req, res, next) {
  try {
    const result = await scanSvc.scan({
      qr: req.body.qr,
      deviceId: req.device.deviceId,
      eventId: req.device.eventId,
      clientScanId: req.body.clientScanId,
      occurredAt: req.body.occurredAt,
      method: 'scan',
    });

    // 200 for every DECIDED outcome, including a refusal.
    //
    // A duplicate ticket is not an HTTP error — it is an answer, and the device
    // needs to render it (with the time of the first scan) rather than show a
    // network failure and invite the operator to retry. Only a locked gate gets
    // a 403, because that is a state the door staff cannot resolve.
    if (result.result === 'scanner_locked') {
      return sendFail(res, {
        status: 403, error: 'SCANNER_LOCKED',
        message: result.message, meta: { reason: result.reason },
      });
    }
    return sendOk(res, result);
  } catch (err) { return next(err); }
}

// POST /scan/sync
async function sync(req, res, next) {
  try {
    const results = await scanSvc.syncBatch({
      deviceId: req.device.deviceId,
      eventId: req.device.eventId,
      scans: Array.isArray(req.body.scans) ? req.body.scans : [],
    });

    // A replay's result IS 'admitted' — correctly, because that guest was
    // admitted. But counting it here would tell the operator the upload just
    // let 2 more people in when it let none. The summary is what they read to
    // know whether the queue landed, so `admitted` has to mean NEW admissions.
    const replayed = results.filter((r) => r.replay).length;
    const admitted = results.filter((r) => r.result === 'admitted' && !r.replay).length;
    // People this device let in offline whose ticket another door had already
    // admitted. Nothing to do at the door any more; the organizer is told.
    const conflicts = results.filter((r) => r.conflict && !r.replay).length;
    logger.info({ deviceId: req.device.deviceId, count: results.length, admitted, replayed, conflicts },
      'offline queue uploaded');

    return sendOk(res, { results, summary: { total: results.length, admitted, replayed, conflicts } });
  } catch (err) { return next(err); }
}

// POST /scan/undo
async function undo(req, res, next) {
  try {
    /**
     * The same rule `scan` enforces: a device may only touch its own event.
     *
     * The ticket id is not secret — it is inside every QR token, readable by
     * anyone holding any ticket — so a device for one event must not be able to
     * reverse an admission at another, given the id. This used to be a separate
     * lookup here, because the v1 RPC had no event in its signature; v2 matches
     * on (ticket, event) itself (T-054).
     *
     * A 404, not a 403 — a device has no business learning that a ticket it may
     * not touch exists.
     */
    const data = await scanSvc.undo({
      ticketId: req.body.ticketId,
      deviceId: req.device.deviceId,
      eventId: req.device.eventId,
    });

    if (data?.result === 'not_found') {
      return sendFail(res, {
        status: 404, error: 'TICKET_NOT_FOUND',
        message: 'That ticket is not for this event.',
      });
    }
    if (!data?.ok) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT', message: data?.message || 'That could not be undone.',
      });
    }
    return sendOk(res, data);
  } catch (err) { return next(err); }
}

// GET /scan/status
async function status(req, res, next) {
  try {
    return sendOk(res, await scanSvc.gateStatus(req.device.eventId));
  } catch (err) { return next(err); }
}

// ═══ ADMIN — the override (BRD §18) ═════════════════════════════════════════

const { writeAudit } = require('../services/auditService');

// POST /admin/events/:eventId/scanner-override
/**
 * Reopens a locked gate for a few hours.
 *
 * It used to answer 200 whatever happened: the upsert's result was never read
 * and the event was never loaded, so a mistyped id or a refused write still
 * reported "open until 11pm" — and wrote an audit row saying so — while the
 * door stayed shut. A cancelled or finished event is refused outright: check-in
 * refuses those anyway, so an override would promise something the gate will
 * not do.
 */
async function override(req, res, next) {
  try {
    const { data: event, error: eventError } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `This event is ${event.status}, so there is no gate to reopen.`,
      });
    }

    const hours = Math.min(Math.max(parseInt(req.body.hours, 10) || 12, 1), 72);
    const until = new Date(Date.now() + hours * 3600e3).toISOString();

    const { error } = await supabase.from('scanner_access').upsert({
      event_id: event.id,
      override_by: req.user.id,
      override_until: until,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });
    if (error) throw new Error(error.message);

    // Time-boxed on purpose. A permanent override is a lock that was quietly
    // removed, and nobody would notice the invoice was never paid.
    logger.warn({ eventId: event.id, by: req.user.id, until }, 'scanner override granted');

    const audited = await writeAudit(req, {
      action: 'scanner.override', targetType: 'event', targetId: event.id,
      payload: { hours, until, reason: req.body.reason || null },
    });

    return sendOk(res, { overrideUntil: until, hours, audited });
  } catch (err) { return next(err); }
}

// POST /admin/events/:eventId/scanner-override/end
/**
 * Ends an override early. There was no way to: once granted, a reopened gate
 * stayed open for its full window even after the reason for it had gone. The
 * gate returns to whatever the invoices say.
 */
async function endOverride(req, res, next) {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('scanner_access')
      .update({ override_until: null, override_by: req.user.id, updated_at: now })
      .eq('event_id', req.params.eventId)
      .gt('override_until', now)
      .select('event_id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'This event has no override running.' });
    }

    logger.warn({ eventId: req.params.eventId, by: req.user.id }, 'scanner override ended early');
    const audited = await writeAudit(req, {
      action: 'scanner.override_ended', targetType: 'event', targetId: req.params.eventId,
      payload: { reason: req.body.reason || null },
    });

    return sendOk(res, { overrideUntil: null, audited });
  } catch (err) { return next(err); }
}

module.exports = {
  createDevice, listDevices, updateDevice, gateStatus, pairingQr,
  deviceLogin, verify, sync, undo, status, override, endOverride,
};
