const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Ticket tiers — the named price bands. "General Admission $40", "VIP $120".
 *
 * The schema has had `ticket_tiers` since the baseline and the seat map reads
 * from it, but nothing could WRITE one: every test creates tiers with a direct
 * insert, and an organizer had no way to price their event by band at all.
 * `seat_price_cents` resolves a seat as
 *
 *     COALESCE(seats.price_override_cents, ticket_tiers.price_cents, 0)
 *
 * so a seat with neither is sold FOR NOTHING. That last `0` is the reason this
 * file matters: without a tier, the fallback is silent and free.
 *
 * TWO RULES THE DATABASE OWNS, and this file only reports:
 *
 *   • BRD §13 — once a ticket has sold at a price, that price is frozen.
 *     `lock_tier_price_after_sale` raises; changing a sold tier's price would
 *     rewrite what a buyer already agreed to pay.
 *
 *   • `sold_within_quantity` — the allocation cannot be cut below what has
 *     already gone out of the door.
 *
 * Both are enforced by triggers, deliberately, because this controller is not
 * the only thing that will ever write to these rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SELECT = 'id, name, description, price_cents, quantity, sold_count, sort_order, created_at';

// ─── GET /events/:eventId/tiers ─────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('ticket_tiers')
      .select(SELECT)
      .eq('event_id', req.params.eventId)
      .order('sort_order')
      .order('created_at');

    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map(shape));
  } catch (err) { return next(err); }
}

// ─── POST /events/:eventId/tiers ────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const name = String(req.body.name).trim();

    // Checked here rather than left to a unique index, because there ISN'T one
    // on (event_id, name) — and two tiers both called "VIP" at different prices
    // is a support call, not a database error.
    const { data: clash } = await supabase
      .from('ticket_tiers')
      .select('id').eq('event_id', req.params.eventId).ilike('name', name).maybeSingle();
    if (clash) {
      return sendFail(res, {
        status: 409, error: 'DUPLICATE_TIER',
        message: `This event already has a tier called "${name}".`,
      });
    }

    const { data, error } = await supabase
      .from('ticket_tiers')
      .insert({
        event_id: req.params.eventId,
        name,
        description: req.body.description ? String(req.body.description).trim() : null,
        price_cents: Math.round(Number(req.body.priceCents)),
        // NULL means "however many seats are mapped to it", which is the normal
        // case for a seated event. A number means a hard allocation.
        quantity: req.body.quantity === undefined || req.body.quantity === null
          ? null : Math.round(Number(req.body.quantity)),
        sort_order: req.body.sortOrder === undefined ? 0 : Math.round(Number(req.body.sortOrder)),
      })
      .select(SELECT)
      .single();

    if (error) throw new Error(error.message);
    return sendOk(res, shape(data), { status: 201 });
  } catch (err) { return next(err); }
}

// ─── PATCH /events/:eventId/tiers/:tierId ───────────────────────────────────
/**
 * The price change is the interesting one, and it is refused by a trigger once
 * anything has sold. Surfaced as a 409 with the reason, not a 500: the
 * organizer asked for something reasonable and the answer is "not any more".
 */
async function update(req, res, next) {
  try {
    const tier = await owned(req);
    if (!tier) return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such tier.' });

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.description !== undefined) {
      patch.description = req.body.description ? String(req.body.description).trim() : null;
    }
    if (req.body.priceCents !== undefined) patch.price_cents = Math.round(Number(req.body.priceCents));
    if (req.body.sortOrder !== undefined) patch.sort_order = Math.round(Number(req.body.sortOrder));
    if (req.body.quantity !== undefined) {
      patch.quantity = req.body.quantity === null ? null : Math.round(Number(req.body.quantity));
      // Caught here as well as by the CHECK, so the organizer is told the
      // number that blocks them instead of reading a constraint name.
      if (patch.quantity !== null && patch.quantity < tier.sold_count) {
        return sendFail(res, {
          status: 409, error: 'BELOW_SOLD',
          message: `${tier.sold_count} ticket${tier.sold_count === 1 ? ' has' : 's have'} already `
                 + `sold on this tier, so the allocation cannot go below ${tier.sold_count}.`,
        });
      }
    }

    if (Object.keys(patch).length === 0) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to change.',
      });
    }

    if (patch.name && patch.name.toLowerCase() !== tier.name.toLowerCase()) {
      const { data: clash } = await supabase
        .from('ticket_tiers').select('id')
        .eq('event_id', req.params.eventId).ilike('name', patch.name).maybeSingle();
      if (clash) {
        return sendFail(res, {
          status: 409, error: 'DUPLICATE_TIER',
          message: `This event already has a tier called "${patch.name}".`,
        });
      }
    }

    const { data, error } = await supabase
      .from('ticket_tiers').update(patch).eq('id', tier.id).select(SELECT).single();

    if (error) {
      if (/PRICE_LOCKED_AFTER_SALE/.test(error.message)) {
        return sendFail(res, {
          status: 409, error: 'PRICE_LOCKED_AFTER_SALE',
          message: 'Tickets have already sold at this price, so it can no longer change. '
                 + 'Create a new tier for the new price.',
        });
      }
      throw new Error(error.message);
    }

    return sendOk(res, shape(data));
  } catch (err) { return next(err); }
}

// ─── DELETE /events/:eventId/tiers/:tierId ──────────────────────────────────
/**
 * Refused if anything references it.
 *
 * `seats.tier_id` is ON DELETE SET NULL, so deleting a tier that seats point at
 * would succeed and silently reprice every one of those seats to zero — the
 * `COALESCE(..., 0)` at the bottom of `seat_price_cents`. A seat map that
 * quietly becomes free is the worst possible outcome of a delete, so the seats
 * are counted first and the delete is refused while any remain.
 */
async function remove(req, res, next) {
  try {
    const tier = await owned(req);
    if (!tier) return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such tier.' });

    if (tier.sold_count > 0) {
      return sendFail(res, {
        status: 409, error: 'TIER_HAS_SALES',
        message: 'Tickets have sold on this tier, so it stays for the record. '
               + 'Set its allocation to what has already sold to stop further sales.',
      });
    }

    const { count: seatCount } = await supabase
      .from('seats').select('id', { count: 'exact', head: true }).eq('tier_id', tier.id);
    if (seatCount) {
      return sendFail(res, {
        status: 409, error: 'TIER_IN_USE',
        message: `${seatCount} seat${seatCount === 1 ? ' is' : 's are'} priced by this tier. `
               + 'Move them to another tier first — deleting it would price them at zero.',
      });
    }

    const { error } = await supabase.from('ticket_tiers').delete().eq('id', tier.id);
    if (error) throw new Error(error.message);

    logger.info({ tierId: tier.id, eventId: req.params.eventId }, 'ticket tier deleted');
    return sendOk(res, { id: tier.id, deleted: true });
  } catch (err) { return next(err); }
}

/**
 * The tier must belong to the event in the URL.
 *
 * verifyEventOwner proves the caller owns the EVENT; it says nothing about
 * whether this tier id belongs to it. Without this, a valid organizer could
 * edit any tier on the platform by pairing their own event id with someone
 * else's tier id.
 */
async function owned(req) {
  const { data } = await supabase
    .from('ticket_tiers')
    .select('id, name, sold_count, price_cents')
    .eq('id', req.params.tierId)
    .eq('event_id', req.params.eventId)
    .maybeSingle();
  return data || null;
}

function shape(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    priceCents: Number(t.price_cents),
    // NULL is not "zero left" — it is "bounded by the seat map, not by a
    // number", and a client that renders it as 0 shows an event as sold out.
    quantity: t.quantity === null ? null : Number(t.quantity),
    soldCount: Number(t.sold_count),
    remaining: t.quantity === null ? null : Number(t.quantity) - Number(t.sold_count),
    sortOrder: Number(t.sort_order),
    createdAt: t.created_at,
  };
}

module.exports = { list, create, update, remove };
