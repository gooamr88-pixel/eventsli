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
    if (result.unavailable) {
      // The database did not answer. A 503, never a 200 'error': the door holds
      // the scan (or decides it from its offline list) and nobody is turned away
      // or let in on a non-answer.
      return sendFail(res, {
        status: 503, error: 'SCAN_UNAVAILABLE',
        message: 'The check-in server is busy. The scan is kept and checked again in a moment.',
      });
    }
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

// ═══ ADMIN — controlling the gate (BRD §18) ═════════════════════════════════

const { writeAudit } = require('../services/auditService');
const notices = require('../services/invoiceNotices');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE CONTROL FOR AN EVENT'S GATE: follow the invoices, keep it open, or keep
 * it closed — optionally until a time (`set_scanner_mode`).
 *
 * There used to be one lever: a super admin reopening a locked gate for 12 to
 * 72 hours. No closing a gate (a dispute, a safety stop), no exempting an event
 * for good (a charity night, a negotiated arrangement), and an override that
 * the hourly overdue job happily ignored the moment it ran out.
 *
 * An admin's decision is never undone by anything automatic: the overdue job
 * only labels invoices, settling an invoice does not touch the mode, and a
 * timed decision ends because its own end time passed — which the admin chose.
 *
 * Every change is audited with the gate before and after, and the organizer
 * is emailed when the door actually changed state.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function applyGateMode(req, res, { mode, until, reason, audit }) {
  const { data, error } = await supabase.rpc('set_scanner_mode', {
    p_event_id: req.params.eventId,
    p_mode: mode,
    p_until: until || null,
    p_reason: reason,
    p_admin_id: req.user.id,
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) {
    const status = data?.error === 'EVENT_NOT_FOUND' ? 404 : data?.error === 'CONFLICT' ? 409 : 400;
    return sendFail(res, { status, error: data?.error || 'VALIDATION_ERROR', message: data?.message });
  }

  logger.warn({ eventId: req.params.eventId, by: req.user.id, mode, until }, 'scanner gate mode set');
  const audited = await writeAudit(req, {
    action: audit, targetType: 'event', targetId: req.params.eventId,
    payload: {
      mode, until: until || null, reason,
      before: { locked: data.before?.locked ?? null, reason: data.before?.reason ?? null, mode: data.before?.mode ?? null },
      after: { locked: data.gate?.locked ?? null, reason: data.gate?.reason ?? null, mode: data.gate?.mode ?? null },
    },
  });
  const notice = req.body.notify === false
    ? { sent: false }
    : await notices.notifyGateChanged(req.params.eventId, { before: data.before, after: data.gate, reason });

  return sendOk(res, {
    gate: data.gate,
    before: data.before,
    // Kept for older console builds that read these.
    overrideUntil: data.gate?.mode === 'open' ? data.gate.mode_until : null,
    organizerNotified: Boolean(notice?.sent),
    audited,
  });
}

// POST /admin/events/:eventId/gate   { mode, until?, reason }
async function setGateMode(req, res, next) {
  try {
    return await applyGateMode(req, res, {
      mode: req.body.mode,
      until: req.body.until || null,
      reason: String(req.body.reason || '').trim(),
      audit: 'scanner.mode',
    });
  } catch (err) { return next(err); }
}

// POST /admin/events/:eventId/scanner-override   { hours?, reason }
/** The old "reopen for N hours" — now "keep open until now + N hours". */
async function override(req, res, next) {
  try {
    const hours = Math.min(Math.max(parseInt(req.body.hours, 10) || 12, 1), 720);
    const until = new Date(Date.now() + hours * 3600e3).toISOString();
    const { data: event } = await supabase.from('events').select('status').eq('id', req.params.eventId).maybeSingle();
    if (event && ['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: `This event is ${event.status}, so there is no gate to reopen.` });
    }
    return await applyGateMode(req, res, {
      mode: 'open', until, reason: String(req.body.reason || '').trim() || 'Override', audit: 'scanner.override',
    });
  } catch (err) { return next(err); }
}

// POST /admin/events/:eventId/scanner-override/end   { reason }
/** Ends an admin's open (or closed) decision early: back to following the invoices. */
async function endOverride(req, res, next) {
  try {
    const { data: row } = await supabase.from('scanner_access')
      .select('mode, mode_until, override_until').eq('event_id', req.params.eventId).maybeSingle();
    const now = Date.now();
    const running = row && (
      (row.mode !== 'auto' && (!row.mode_until || Date.parse(row.mode_until) > now))
      || (row.override_until && Date.parse(row.override_until) > now));
    if (!running) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'This event has no override running.' });
    }
    return await applyGateMode(req, res, {
      mode: 'auto', until: null, reason: String(req.body.reason || '').trim() || 'Override ended', audit: 'scanner.override_ended',
    });
  } catch (err) { return next(err); }
}

module.exports = {
  createDevice, listDevices, updateDevice, gateStatus, pairingQr,
  deviceLogin, verify, sync, undo, status, override, endOverride, setGateMode,
};
