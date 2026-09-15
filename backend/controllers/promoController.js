const promo = require('../services/promoService');
const pricing = require('../services/pricingService');
const { supabase } = require('../config/supabase');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');

const accessTokens = require('../services/accessTokens');

const asFailure = (res, err) => sendFail(res, {
  status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message,
});

/**
 * The reservation token proves this caller made the hold.
 *
 * Applying or removing a code changes what someone else is about to be charged,
 * so the hold's id — which travels to the client and can be picked up — is not
 * authority to do it.
 */
const ownsReservation = (req) =>
  accessTokens.readReservationToken(accessTokens.fromRequest(req)) === req.params.reservationId;

// ═══ PUBLIC — applying a code at the checkout ═══════════════════════════════

/**
 * POST /public/reservations/:reservationId/promo
 *
 * Applied against the HOLD, and the quote is returned with it. The buyer sees
 * the new total immediately, and there is no second number to disagree with the
 * one they are charged.
 */
async function apply(req, res, next) {
  try {
    if (!ownsReservation(req)) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN', message: 'That hold is not yours.',
      });
    }

    const { data: reservation } = await supabase
      .from('reservations')
      .select('id, event_id, state, expires_at')
      .eq('id', req.params.reservationId)
      .maybeSingle();

    if (!reservation || reservation.state !== 'active') {
      return sendFail(res, {
        status: 410, error: 'RESERVATION_EXPIRED',
        message: 'Your seats were released. Please choose them again.',
      });
    }

    // Priced BEFORE the claim, so a percentage discount is taken against the
    // real subtotal rather than one the client suggested.
    const before = await pricing.quoteReservation(req.params.reservationId);

    const claimed = await promo.claim({
      code: req.body.code,
      eventId: reservation.event_id,
      reservationId: req.params.reservationId,
      subtotalCents: before.breakdown.subtotalCents,
    });

    const after = await pricing.quoteReservation(req.params.reservationId);

    return sendOk(res, {
      code: claimed.code,
      discountCents: claimed.discount_cents,
      quote: pricing.publicBreakdown(after),
    });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// DELETE /public/reservations/:reservationId/promo
async function remove(req, res, next) {
  try {
    if (!ownsReservation(req)) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN', message: 'That hold is not yours.',
      });
    }
    // Only from an open hold. Once paid, the claim is part of what was bought:
    // removing it here used to free a single-use code for someone else.
    const { data: reservation } = await supabase
      .from('reservations').select('state').eq('id', req.params.reservationId).maybeSingle();
    if (!reservation || reservation.state !== 'active') {
      return sendFail(res, {
        status: 410, error: 'RESERVATION_EXPIRED',
        message: 'That hold has ended, so its code can no longer be removed.',
      });
    }

    await promo.release(req.params.reservationId);
    const q = await pricing.quoteReservation(req.params.reservationId);
    return sendOk(res, { removed: true, quote: pricing.publicBreakdown(q) });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// ═══ ORGANIZER ══════════════════════════════════════════════════════════════

async function list(req, res, next) {
  try {
    return sendOk(res, await promo.list(req.params.eventId));
  } catch (err) { return next(err); }
}

async function create(req, res, next) {
  try {
    const created = await promo.create({
      eventId: req.params.eventId,
      code: req.body.code,
      discountType: req.body.discountType,
      discountValue: Number(req.body.discountValue),
      maxUses: req.body.maxUses === undefined || req.body.maxUses === null
        ? null : Number(req.body.maxUses),
      validFrom: req.body.validFrom,
      validUntil: req.body.validUntil,
    });
    return sendOk(res, created, { status: 201 });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// PATCH /events/:eventId/promos/:promoId
async function setActive(req, res, next) {
  try {
    // Deactivated, never deleted: orders point at the code they were bought
    // with, and deleting it makes a past receipt unexplainable.
    return sendOk(res, await promo.setActive({
      promoId: req.params.promoId,
      eventId: req.params.eventId,
      isActive: !!req.body.isActive,
    }));
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

module.exports = { apply, remove, list, create, setActive };
