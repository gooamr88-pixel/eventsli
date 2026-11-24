const { supabase } = require('../config/supabase');
const offline = require('../services/offlineCheckoutService');
const accessTokens = require('../services/accessTokens');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * Offline checkout (phase 2) — the buyer's side and the organizer's side.
 * Thin: every rule lives in the Postgres functions (see the service).
 */

const statusFor = (code) => ERROR_STATUS[code] || 400;
const asFailure = (res, err) => sendFail(res, {
  status: statusFor(err.code), error: err.code, message: err.message, meta: err.meta,
});
const handle = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    if (err.code && ERROR_STATUS[err.code]) return asFailure(res, err);
    return next(err);
  }
};

function ownsReservation(req) {
  return accessTokens.readReservationToken(accessTokens.reservationTokenFrom(req)) === req.params.reservationId;
}
const NOT_YOURS = { status: 403, error: 'FORBIDDEN', message: 'That hold is not yours.' };

// ─── Buyer ──────────────────────────────────────────────────────────────────
// GET /public/reservations/:reservationId/offline-options
const options = handle(async (req, res) => {
  if (!ownsReservation(req)) return sendFail(res, NOT_YOURS);
  return sendOk(res, await offline.optionsForReservation(req.params.reservationId));
});

// GET /public/offline-payments/:id
const view = handle(async (req, res) => sendOk(res,
  await offline.viewForBuyer(req.params.id, accessTokens.fromRequest(req))));

// POST /public/offline-payments/:id/cancel
// POST /public/offline-payments/:id/proof/sign — a signed upload for the receipt.
const signProof = handle(async (req, res) => sendOk(res,
  await offline.signProofUpload(req.params.id, accessTokens.fromRequest(req), req.body.contentType)));

// POST /public/offline-payments/:id/proof — the receipt landed; record it.
const attachProof = handle(async (req, res) => sendOk(res,
  await offline.attachProof(req.params.id, accessTokens.fromRequest(req), req.body.path)));

// POST /public/offline-payments/:id/sent — "I've sent the payment".
const markSent = handle(async (req, res) => sendOk(res,
  await offline.markSent(req.params.id, accessTokens.fromRequest(req))));

const cancelByBuyer = handle(async (req, res) => {
  await offline.cancelByBuyer(req.params.id, accessTokens.fromRequest(req));
  return sendOk(res, await offline.viewForBuyer(req.params.id, accessTokens.fromRequest(req)));
});

// ─── Organizer (behind verifyEventOwner) ────────────────────────────────────
/** The event's organizer, and whether the person acting is an admin doing it for them. */
async function actingFor(req) {
  const event = req.event || (await supabase.from('events').select('id, organizer_id')
    .eq('id', req.params.eventId).maybeSingle()).data;
  if (!event) throw Object.assign(new Error('That event does not exist.'), { code: 'EVENT_NOT_FOUND' });
  const owner = req.user?.access?.organizerId === event.organizer_id;
  return { organizerId: event.organizer_id, role: owner ? 'organizer' : 'admin' };
}

/** A payment belongs to this event, or it is "not found" — never another event's. */
async function assertOnEvent(table, id, eventId) {
  const { data } = await supabase.from(table).select('id').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!data) throw Object.assign(new Error('That is not part of this event.'), { code: 'NOT_FOUND' });
}

// GET /events/:eventId/offline-payments
const list = handle(async (req, res) => {
  const s = await offline.settings();
  return sendOk(res, {
    enabled: s.enabled === true,
    payments: await offline.listForEvent(req.params.eventId, { status: req.query.status || null }),
  });
});

// POST /events/:eventId/offline-payments/:offlineId/confirm
const confirm = handle(async (req, res) => {
  const { organizerId } = await actingFor(req);
  await assertOnEvent('offline_payments', req.params.offlineId, req.params.eventId);
  const result = await offline.confirm({
    offlineId: req.params.offlineId, organizerId, actorId: req.user.id,
    amountCents: Number(req.body.amountCents), reference: req.body.reference, confirmKey: req.body.confirmKey,
  });
  logger.info({ offlinePaymentId: req.params.offlineId, orderId: result.order_id, by: req.user.id, duplicate: !!result.duplicate },
    'offline payment confirmed');
  return sendOk(res, result);
});

// POST /events/:eventId/offline-payments/:offlineId/cancel
const cancelByOrganizer = handle(async (req, res) => {
  const { organizerId } = await actingFor(req);
  await assertOnEvent('offline_payments', req.params.offlineId, req.params.eventId);
  return sendOk(res, await offline.cancelByOrganizer({
    offlineId: req.params.offlineId, organizerId, actorId: req.user.id, reason: req.body.reason,
  }));
});

// POST /events/:eventId/orders/:orderId/void
const voidOrder = handle(async (req, res) => {
  const { organizerId, role } = await actingFor(req);
  await assertOnEvent('orders', req.params.orderId, req.params.eventId);
  const result = await offline.voidOrder({
    orderId: req.params.orderId, organizerId, actorId: req.user.id, role, kind: req.body.kind, reason: req.body.reason,
  });
  logger.info({ orderId: req.params.orderId, kind: req.body.kind, by: req.user.id }, 'offline order voided');
  return sendOk(res, result);
});

// GET /events/:eventId/payment-audit
const audit = handle(async (req, res) => sendOk(res, await offline.auditForEvent(req.params.eventId)));

module.exports = {
  options, view, cancelByBuyer, list, confirm, cancelByOrganizer, voidOrder, audit, signProof, attachProof, markSent,
};
