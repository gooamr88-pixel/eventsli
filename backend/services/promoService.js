const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Promo codes.
 *
 * The discount is claimed at HOLD time, not at payment. A code with a use limit
 * is stock like a seat is stock: if it is only counted when the charge lands,
 * ten people at the checkout screen with the last use of a code all get it, and
 * nine of them are charged the wrong amount.
 *
 * All the validation and the claim happen inside `claim_promo_code`, under a
 * row lock, because the check and the count have to be one indivisible act.
 */

async function claim({ code, eventId, reservationId, subtotalCents }) {
  const { data, error } = await supabase.rpc('claim_promo_code', {
    p_code: String(code || '').trim(),
    p_event_id: eventId,
    p_reservation_id: reservationId,
    p_subtotal_cents: subtotalCents,
  });

  if (error) {
    logger.error({ err: error.message, eventId }, 'promo claim failed');
    throw fail('CONFLICT', 'That code could not be applied.');
  }
  if (!data?.ok) throw fail(data?.error || 'NOT_FOUND', data?.message || 'That code is not valid.');
  return data;
}

/** Called whenever a hold is released, or a limited code leaks a use per abandoned checkout. */
async function release(reservationId) {
  const { error } = await supabase.rpc('release_promo_claim', { p_reservation_id: reservationId });
  if (error) logger.warn({ err: error.message, reservationId }, 'promo claim not released');
}

/** What a hold currently has applied, for the quote to subtract. */
async function forReservation(reservationId) {
  const { data } = await supabase
    .from('promo_redemptions')
    .select('promo_id, amount_cents, promo_codes ( code, discount_type, discount_value )')
    .eq('reservation_id', reservationId)
    .maybeSingle();

  if (!data) return null;
  return {
    promoId: data.promo_id,
    code: data.promo_codes?.code,
    discountCents: Number(data.amount_cents),
  };
}

// ─── Organizer management ──────────────────────────────────────────────────

async function list(eventId) {
  const { data } = await supabase
    .from('promo_codes')
    .select('id, code, discount_type, discount_value, max_uses, used_count, valid_from, valid_until, is_active')
    .eq('event_id', eventId)
    .order('code');

  return (data || []).map((p) => ({
    id: p.id,
    code: p.code,
    discountType: p.discount_type,
    discountValue: Number(p.discount_value),
    maxUses: p.max_uses,
    usedCount: p.used_count,
    validFrom: p.valid_from,
    validUntil: p.valid_until,
    isActive: p.is_active,
  }));
}

async function create({ eventId, code, discountType, discountValue, maxUses, validFrom, validUntil }) {
  // Stored upper-case and compared upper-case. A buyer typing `summer10` and a
  // buyer typing `SUMMER10` are using the same code, and telling one of them it
  // does not exist is a support ticket.
  const normalised = String(code).trim().toUpperCase();

  if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
    throw fail('VALIDATION_ERROR', 'A percentage discount must be between 1 and 100.');
  }
  if (discountType === 'fixed' && discountValue <= 0) {
    throw fail('VALIDATION_ERROR', 'A fixed discount must be more than zero.');
  }

  const { data, error } = await supabase
    .from('promo_codes')
    .insert({
      event_id: eventId,
      code: normalised,
      discount_type: discountType,
      discount_value: discountValue,
      max_uses: maxUses ?? null,
      valid_from: validFrom || null,
      valid_until: validUntil || null,
    })
    .select('id, code, discount_type, discount_value, max_uses, used_count, valid_from, valid_until, is_active')
    .single();

  if (error) {
    if (error.code === '23505') throw fail('CONFLICT', `The code ${normalised} already exists for this event.`);
    throw fail('VALIDATION_ERROR', error.message);
  }
  return data;
}

/**
 * Deactivating, not deleting.
 *
 * Orders point at the code they were bought with. Deleting it would orphan
 * those rows and make a past receipt unexplainable.
 */
async function setActive({ promoId, eventId, isActive }) {
  const { data, error } = await supabase
    .from('promo_codes')
    .update({ is_active: isActive })
    .eq('id', promoId)
    .eq('event_id', eventId)     // scoped: not another organizer's code
    .select('id, code, is_active')
    .single();

  if (error || !data) throw fail('NOT_FOUND', 'No such code.');
  return data;
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { claim, release, forReservation, list, create, setActive };
