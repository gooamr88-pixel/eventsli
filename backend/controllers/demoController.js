const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { hashIp } = require('../utils/crypto');
const { writeAudit } = require('../services/auditService');
const svc = require('../services/demo/demoService');
const admin = require('../services/demo/demoAdmin');
const { publicView } = require('../services/demo/demoSettings');

/**
 * Book a demo (2026-11-19): the public page and the console.
 * Services answer `{ code, message }` for a refusal; this turns it into the
 * envelope with the status from responseEnvelope's table.
 */

function refuse(res, { code, message }) {
  return sendFail(res, { status: ERROR_STATUS[code] || 400, error: code, message: message || undefined });
}

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (err) { return next(err); }
};

// ── Public ───────────────────────────────────────────────────────────────

const publicSettings = wrap(async (req, res) => sendOk(res, publicView(await svc.getSettings())));

const publicSlots = wrap(async (req, res) => {
  const result = await svc.slots({ from: req.query.from, to: req.query.to });
  return sendOk(res, result);
});

const book = wrap(async (req, res) => {
  // The hidden "website" field: people never see it, form-filling bots do.
  // They get a believable answer and nothing is booked or sent.
  if (req.body.website) return sendOk(res, { booking: null, token: null }, { status: 201 });
  const result = await svc.createBooking(req.body, { ipHash: req.ip ? hashIp(req.ip) : null });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const view = wrap(async (req, res) => {
  const result = await svc.viewForBooker(req.params.id, req.query.t);
  if (result.code) return refuse(res, { code: 'NOT_FOUND', message: 'This booking link is not valid.' });
  return sendOk(res, result);
});

const cancelOwn = wrap(async (req, res) => {
  const result = await svc.cancelByBooker(req.params.id, req.body.t, { reason: req.body.reason });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? { code: 'NOT_FOUND', message: 'This booking link is not valid.' } : result);
  return sendOk(res, result);
});

const rescheduleOwn = wrap(async (req, res) => {
  const result = await svc.rescheduleByBooker(req.params.id, req.body.t, { startsAt: req.body.startsAt });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? { code: 'NOT_FOUND', message: 'This booking link is not valid.' } : result);
  return sendOk(res, result);
});

const calendar = wrap(async (req, res) => {
  const result = await svc.calendarFile(req.params.id, req.query.t);
  if (result.code) return res.status(404).type('text/plain').send('Not found');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="eventsli-demo.ics"');
  res.set('Cache-Control', 'no-store');
  return res.send(result.ics);
});

// ── Console ──────────────────────────────────────────────────────────────

const adminSettings = wrap(async (req, res) => sendOk(res, { settings: await svc.getSettings() }));

const adminSaveSettings = wrap(async (req, res) => {
  const before = await svc.getSettings();
  const settings = await svc.saveSettings(req.body.settings);
  const changed = Object.keys(settings).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(before[k]));
  await writeAudit(req, { action: 'demo.settings_updated', targetType: 'platform_setting', targetId: null, payload: { changed } });
  // The /demo page caches its settings for a minute; a save shows at once.
  require('../services/revalidateService').revalidate(['demo']).catch(() => {});
  return sendOk(res, { settings });
});

const adminList = wrap(async (req, res) => sendOk(res, await admin.list({
  view: admin.VIEWS.includes(req.query.view) ? req.query.view : 'upcoming',
  q: req.query.q || '',
  page: Number(req.query.page) || 1,
})));

const adminGet = wrap(async (req, res) => {
  const booking = await admin.get(req.params.id);
  if (!booking) return refuse(res, { code: 'NOT_FOUND' });
  return sendOk(res, { booking, links: { manageUrl: svc.links(booking.id).manageUrl } });
});

const adminHosts = wrap(async (req, res) => sendOk(res, { hosts: await admin.hosts() }));

const adminUpdate = wrap(async (req, res) => {
  const { status, hostNotes, meetingLink, assignedTo, notify } = req.body;
  const result = await admin.update(req.params.id, { status, hostNotes, meetingLink, assignedTo }, { notify: notify === true });
  if (result.code) return refuse(res, result);
  await writeAudit(req, {
    action: 'demo.booking_updated',
    targetType: 'demo_booking',
    targetId: req.params.id,
    payload: {
      fields: Object.keys(req.body).filter((k) => k !== 'notify'),
      ...(status !== undefined ? { from: result.before.status, to: status } : {}),
    },
  });
  return sendOk(res, { booking: result.booking });
});

const adminCancel = wrap(async (req, res) => {
  const result = await admin.cancel(req.params.id, { reason: req.body.reason, notify: req.body.notify !== false });
  if (result.code) return refuse(res, result);
  await writeAudit(req, {
    action: 'demo.booking_cancelled', targetType: 'demo_booking', targetId: req.params.id,
    payload: { reason: req.body.reason || null, notified: req.body.notify !== false },
  });
  return sendOk(res, { booking: result.booking });
});

const adminReschedule = wrap(async (req, res) => {
  const result = await admin.reschedule(req.params.id, { startsAt: req.body.startsAt, notify: req.body.notify !== false });
  if (result.code) return refuse(res, result);
  await writeAudit(req, {
    action: 'demo.booking_rescheduled', targetType: 'demo_booking', targetId: req.params.id,
    payload: { from: result.before.startsAt, to: result.booking.startsAt, notified: req.body.notify !== false },
  });
  return sendOk(res, { booking: result.booking });
});

module.exports = {
  publicSettings, publicSlots, book, view, cancelOwn, rescheduleOwn, calendar,
  adminSettings, adminSaveSettings, adminList, adminGet, adminHosts, adminUpdate, adminCancel, adminReschedule,
};
