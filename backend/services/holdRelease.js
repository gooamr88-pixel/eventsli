const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Puts a hold's seats, table or tickets back on sale — the one way it is done.
 *
 * Shared by `POST /reservations/:id/release` (the buyer's Remove) and the
 * cart's merge (adding more to an event already in the cart releases the old
 * hold inside the same request that holds the combined selection). Written
 * once, because each step guards money:
 *
 *   1. a Stripe page still open on the hold is made unpayable first, and the
 *      release is refused if it was already paid — that payment's fulfilment
 *      needs the hold (TECH-AUDIT-LOG T-010);
 *   2. a claimed promo code is let go, or a limited code leaks one use per
 *      abandoned checkout;
 *   3. `release_reservation` frees the stock.
 *
 * Throws an Error with `code` (and the API's message) when the release is
 * refused, so each caller answers in its own shape.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function releaseHold(reservationId) {
  await require('./checkoutSessions').closeOpenSession(reservationId);
  await require('./promoService').release(reservationId);

  const { data: result, error } = await supabase.rpc('release_reservation', { p_reservation_id: reservationId });
  if (error) throw new Error(`release_reservation failed: ${error.message}`);
  if (!result?.ok) {
    throw Object.assign(new Error(result?.message || 'That hold could not be released.'), {
      code: result?.error || 'CONFLICT',
    });
  }
  return { seatsReleased: result.seats_released };
}

/**
 * What a hold holds, in the shape `POST /events/:slug/hold` takes — so a hold
 * can be put back exactly as it was if a merge fails, and so the cart can send
 * the combined selection.
 *
 * @returns {{ seatIds?: string[], tableId?: string, lines?: {tierId: string, quantity: number}[] } | null}
 */
async function heldSelection(reservationId) {
  const { data, error } = await supabase
    .from('reservation_items').select('seat_id, table_id, tier_id, quantity')
    .eq('reservation_id', reservationId);
  if (error) throw new Error(`hold items lookup failed: ${error.message}`);
  const items = data || [];
  if (items.length === 0) return null;
  const table = items.find((i) => i.table_id);
  if (table) return { tableId: table.table_id };
  const seats = items.filter((i) => i.seat_id).map((i) => i.seat_id);
  if (seats.length) return { seatIds: seats };
  return {
    lines: items.filter((i) => i.tier_id).map((i) => ({ tierId: i.tier_id, quantity: Math.max(1, Number(i.quantity) || 1) })),
  };
}

module.exports = { releaseHold, heldSelection };
