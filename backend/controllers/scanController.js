const { supabase } = require('../config/supabase');
const scanSvc = require('../services/scanService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

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

// ═══ DEVICE — at the door ═══════════════════════════════════════════════════

// POST /scan/login
async function deviceLogin(req, res, next) {
  try {
    const result = await scanSvc.authenticateDevice({
      deviceId: req.body.deviceId, pin: req.body.pin,
    });
    if (!result) {
      logger.warn({ deviceId: req.body.deviceId, ip: req.ip }, 'device login failed');
      return sendFail(res, {
        status: 401, error: 'UNAUTHENTICATED',
        message: 'That device id or PIN is not right.',
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
    logger.info({ deviceId: req.device.deviceId, count: results.length, admitted, replayed },
      'offline queue uploaded');

    return sendOk(res, { results, summary: { total: results.length, admitted, replayed } });
  } catch (err) { return next(err); }
}

// POST /scan/undo
async function undo(req, res, next) {
  try {
    /**
     * The same rule `scan` enforces, which this route was missing.
     *
     * `verify` refuses a ticket whose token names another event — "a valid
     * ticket for ANOTHER event must not open this door". Undo took a bare
     * ticket id and passed it straight to the RPC, which does not look at the
     * event either. So a device authenticated for one event could reverse the
     * admission of a guest at a different one, given the id.
     *
     * That id is not secret in the way it would need to be for that to be
     * acceptable: it is inside every QR token, so it is readable by anyone
     * holding any ticket to any event on the platform.
     *
     * Checked here rather than in the RPC because the RPC's signature has no
     * event in it and adding one would change a function two other paths call.
     * A 404, not a 403 — a device has no business learning that a ticket it may
     * not touch exists.
     */
    const { data: ticket } = await supabase
      .from('tickets').select('id')
      .eq('id', req.body.ticketId)
      .eq('event_id', req.device.eventId)
      .maybeSingle();

    if (!ticket) {
      return sendFail(res, {
        status: 404, error: 'TICKET_NOT_FOUND',
        message: 'That ticket is not for this event.',
      });
    }

    const { data } = await supabase.rpc('undo_check_in', {
      p_ticket_id: req.body.ticketId, p_device_id: req.device.deviceId,
    });
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

// POST /admin/events/:eventId/scanner-override
async function override(req, res, next) {
  try {
    const hours = Math.min(Math.max(parseInt(req.body.hours, 10) || 12, 1), 72);
    const until = new Date(Date.now() + hours * 3600e3).toISOString();

    await supabase.from('scanner_access').upsert({
      event_id: req.params.eventId,
      override_by: req.user.id,
      override_until: until,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });

    // Time-boxed on purpose. A permanent override is a lock that was quietly
    // removed, and nobody would notice the invoice was never paid.
    logger.warn({ eventId: req.params.eventId, by: req.user.id, until },
      'scanner override granted');

    await supabase.from('admin_audit').insert({
      actor_id: req.user.id, action: 'scanner.override',
      target_type: 'event', target_id: req.params.eventId,
      payload: { hours, until, reason: req.body.reason || null },
    });

    return sendOk(res, { overrideUntil: until, hours });
  } catch (err) { return next(err); }
}

module.exports = {
  createDevice, listDevices, updateDevice, gateStatus,
  deviceLogin, verify, sync, undo, status, override,
};
