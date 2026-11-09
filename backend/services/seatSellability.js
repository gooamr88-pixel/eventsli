/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH SEATS A BUYER CAN ACTUALLY TAKE (TECH-AUDIT-LOG S-07).
 *
 * The public seat map marked a seat available when nobody held it. `hold_seats`
 * refuses far more than that — a seat with no price, a ticket type outside its
 * sale window, a ticket type whose allocation is used up — so a buyer could
 * choose six seats, press Continue, and be refused for reasons the map never
 * showed. For the ticket-type refusals the page then reloaded the map, which
 * showed the same seats free again: a loop.
 *
 * This mirrors the checks in `hold_seats` (supabase/migrations, latest
 * 20261112090000) on rows the map has already read. The database stays the
 * authority: if the two ever disagree the hold refuses, as before, but the map
 * no longer invites it. Pure, so the rules are tested without a database.
 *
 *   taken        held or sold (or blocked by the organizer)
 *   not_on_sale  no price at all, or its ticket type is outside its sale window
 *   sold_out     its ticket type's allocation is used up by sales and live holds
 * ─────────────────────────────────────────────────────────────────────────────
 */

function windowOpen(tier, now) {
  if (tier.sales_start_at && now < new Date(tier.sales_start_at)) return false;
  if (tier.sales_end_at && now >= new Date(tier.sales_end_at)) return false;
  return true;
}

/**
 * @param {Array<{id, tier_id, status, price_override_cents}>} seats  every seat on the map
 * @param {Array<{id, price_cents, quantity, sold_count, sales_start_at, sales_end_at}>} tiers
 */
function sellableSeats(seats, tiers, now = new Date()) {
  // Held seats count against the allocation, exactly as tier_allocation_exceeded
  // counts them — including holds on private tables the buyer cannot see.
  const held = new Map();
  for (const s of seats) {
    if (s.status === 'held' && s.tier_id) held.set(s.tier_id, (held.get(s.tier_id) || 0) + 1);
  }

  const tier = new Map(tiers.map((t) => {
    const quantity = t.quantity === null || t.quantity === undefined ? null : Number(t.quantity);
    const used = Number(t.sold_count || 0) + (held.get(t.id) || 0);
    return [t.id, {
      price: Number(t.price_cents),
      onSale: windowOpen(t, now),
      soldOut: quantity !== null && used >= quantity,
    }];
  }));

  const priceOf = (s) => {
    if (s.price_override_cents !== null && s.price_override_cents !== undefined) return Number(s.price_override_cents);
    const t = tier.get(s.tier_id);
    return t ? t.price : null;
  };

  const reasonFor = (s) => {
    if (s.status !== 'available') return 'taken';
    if (priceOf(s) === null) return 'not_on_sale';
    const t = s.tier_id ? tier.get(s.tier_id) : null;
    if (t && !t.onSale) return 'not_on_sale';
    if (t && t.soldOut) return 'sold_out';
    return null;
  };

  return { tier, priceOf, reasonFor };
}

module.exports = { sellableSeats };
