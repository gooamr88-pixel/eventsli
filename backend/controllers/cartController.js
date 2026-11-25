const { supabase } = require('../config/supabase');
const accessTokens = require('../services/accessTokens');
const pricing = require('../services/pricingService');
const { heldSelection } = require('../services/holdRelease');
const { sendOk } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CART (owner, 2026-11-17).
 *
 * A cart is the buyer's live HOLDS — one reservation per event, each with its
 * own 35-minute clock — across as many events as they like. At checkout it is
 * grouped by organizer, because a card payment goes to one organizer's own
 * Stripe account and cannot cover two.
 *
 * NO CART TABLE. What the buyer holds is already in `reservations`, so the
 * cart is read from there every time, never kept as a second copy that could
 * disagree with the stock:
 *
 *   · a guest's device keeps the reservation TOKENS it was given at each hold
 *     and sends them here; a token is the proof the hold is theirs;
 *   · a signed-in buyer's holds carry their user id, so every device they sign
 *     in on sees the same cart. Holds a guest made on this device join the
 *     account the moment they are read here signed in (the token proves them),
 *     which is how a cart survives "sign in to check out".
 *
 * Each item comes back with a FRESH token (to the person who proved it), its
 * deadline, what is held, and the total the checkout will charge — from the
 * same quote the checkout uses, so the cart and the payment cannot differ.
 * Holds that are gone come back in `gone`, with why, so the page can say so.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_ITEMS = 20;

async function view(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, MAX_ITEMS) : [];
    const proven = [...new Set(tokens.map((t) => accessTokens.readReservationToken(t)).filter(Boolean))];

    // A signed-in buyer: their own holds, plus the device's guest holds, which
    // are claimed for the account (only ones nobody else owns).
    let mine = [];
    if (userId) {
      if (proven.length) {
        const { error: claimError } = await supabase.from('reservations')
          .update({ user_id: userId }).in('id', proven).is('user_id', null).eq('state', 'active');
        if (claimError) logger.warn({ err: claimError.message }, 'cart: could not attach guest holds to the account');
      }
      const { data, error } = await supabase.from('reservations')
        .select('id').eq('user_id', userId).eq('state', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at').limit(MAX_ITEMS);
      if (error) throw new Error(`cart: holds lookup failed: ${error.message}`);
      mine = (data || []).map((r) => r.id);
    }

    const ids = [...new Set([...mine, ...proven])].slice(0, MAX_ITEMS);
    const items = [];
    const gone = [];
    for (const id of ids) {
      // One at a time: a cart is a handful of holds, and each quote is several
      // reads; in parallel they would compete for the same connections.
      // eslint-disable-next-line no-await-in-loop
      const item = await describe(id);
      if (item.gone) gone.push({ reservationId: id, reason: item.gone });
      else items.push(item);
    }

    // Grouped by organizer, in the order the buyer added them.
    const groups = [];
    for (const item of items) {
      let group = groups.find((g) => g.organizer.id === item.organizer.id && g.currency === item.currency);
      if (!group) {
        group = { organizer: item.organizer, currency: item.currency, totalCents: 0, items: [] };
        groups.push(group);
      }
      group.items.push(item);
      group.totalCents += item.totalCents;
    }

    return sendOk(res, { items, groups, gone, count: items.reduce((n, i) => n + i.ticketCount, 0) });
  } catch (err) { return next(err); }
}

/** One hold as the cart shows it, or `{ gone: reason }`. */
async function describe(reservationId) {
  let q;
  try {
    q = await pricing.quoteReservation(reservationId);
  } catch (err) {
    if (!err.code) throw err;
    // Bought already? Then it left the cart because it worked.
    const { data: r } = await supabase.from('reservations').select('state').eq('id', reservationId).maybeSingle();
    return { gone: r?.state === 'converted' ? 'purchased' : err.code === 'EVENT_NOT_PUBLISHED' ? 'off_sale' : 'expired' };
  }

  const [held, selection] = await Promise.all([linesFor(reservationId, q.items, { tablePlaces: q.event?.purchase_mode === 'table_places' }), heldSelection(reservationId)]);
  // Add-ons chosen at checkout (2026-11-17) are part of the total, so they are listed.
  const lines = [...held, ...(q.addons || []).map((a) => ({
    kind: 'addon', label: a.name, quantity: a.quantity, amountCents: a.amountCents,
  }))];
  const b = q.breakdown;
  const e = q.event;
  const org = Array.isArray(e.organizers) ? e.organizers[0] : e.organizers;
  return {
    reservationId,
    reservationToken: accessTokens.issueReservationToken(reservationId),
    expiresAt: q.reservation.expires_at,
    addedAt: q.reservation.created_at,
    event: {
      id: e.id, slug: e.slug, title: e.title, coverUrl: e.cover_url || null,
      startsAt: e.starts_at, endsAt: e.ends_at, timezone: e.timezone,
      venue: e.venue_name || null, city: e.city || null,
    },
    organizer: { id: e.organizer_id, name: org?.display_name || 'The organizer' },
    currency: e.currency,
    lines,
    selection,
    ticketCount: q.admits,
    subtotalCents: b.subtotalCents,
    discountCents: b.discountCents || 0,
    feesCents: Math.max(0, b.buyerTotalCents - b.subtotalCents + (b.discountCents || 0)),
    totalCents: b.buyerTotalCents,
  };
}

/**
 * What is held, in words: "Premium Orchestra · 3 seats — A-5, A-6, A-7",
 * "Table VIP 3 · 10 seats", "2 × General admission". Grouped by ticket type.
 */
async function linesFor(reservationId, items, { tablePlaces = false } = {}) {
  const seatIds = items.filter((i) => i.seat_id).map((i) => i.seat_id);
  const tableIds = items.filter((i) => i.table_id).map((i) => i.table_id);
  const tierIds = [...new Set(items.map((i) => i.tier_id).filter(Boolean))];
  const [seats, tables, tiers] = await Promise.all([
    seatIds.length ? supabase.from('seats').select('id, row_label, seat_number, section_key, tier_id, tables ( label )').in('id', seatIds) : { data: [] },
    tableIds.length ? supabase.from('tables').select('id, label, seat_count').in('id', tableIds) : { data: [] },
    tierIds.length ? supabase.from('ticket_tiers').select('id, name').in('id', tierIds) : { data: [] },
  ]);
  const tierName = new Map((tiers.data || []).map((t) => [t.id, t.name]));
  const priceOf = new Map(items.map((i) => [i.seat_id || i.table_id || `${i.tier_id}`, Number(i.unit_price_cents)]));
  const out = [];

  for (const t of tables.data || []) {
    out.push({ kind: 'table', label: `Table ${t.label}`, quantity: 1, seats: Number(t.seat_count) || null, amountCents: priceOf.get(t.id) ?? null });
  }

  /**
   * PLACES AT A TABLE (2026-11-25): "Table 12 · 3 places", one line per
   * table and never a seat number — the guests sit anywhere at it.
   */
  const byTable = new Map();
  if (tablePlaces) {
    for (const s of seats.data || []) {
      const tbl = Array.isArray(s.tables) ? s.tables[0] : s.tables;
      if (!tbl?.label) continue;
      const item = items.find((i) => i.seat_id === s.id);
      const entry = byTable.get(tbl.label) || { kind: 'places', label: `Table ${tbl.label}`, quantity: 0, tiers: [], amountCents: 0 };
      entry.quantity += 1;
      const tier = tierName.get(item?.tier_id || s.tier_id);
      if (tier && !entry.tiers.includes(tier)) entry.tiers.push(tier);
      entry.amountCents += priceOf.get(s.id) || 0;
      byTable.set(tbl.label, entry);
    }
    out.push(...byTable.values());
  }

  const bySeatTier = new Map();
  for (const s of seats.data || []) {
    if (tablePlaces && (Array.isArray(s.tables) ? s.tables[0] : s.tables)?.label) continue;
    const item = items.find((i) => i.seat_id === s.id);
    const key = item?.tier_id || s.tier_id || 'none';
    const tbl = Array.isArray(s.tables) ? s.tables[0] : s.tables;
    const place = tbl?.label ? `${tbl.label}-${s.seat_number}` : [s.row_label, s.seat_number].filter(Boolean).join('-');
    const entry = bySeatTier.get(key) || { kind: 'seats', label: tierName.get(key) || 'Seats', quantity: 0, places: [], amountCents: 0 };
    entry.quantity += 1;
    entry.places.push(place);
    entry.amountCents += priceOf.get(s.id) || 0;
    bySeatTier.set(key, entry);
  }
  out.push(...bySeatTier.values());

  for (const i of items.filter((x) => !x.seat_id && !x.table_id && x.tier_id)) {
    const quantity = Math.max(1, Number(i.quantity) || 1);
    out.push({ kind: 'general', label: tierName.get(i.tier_id) || 'Tickets', quantity, amountCents: Number(i.unit_price_cents) * quantity });
  }
  return out;
}

module.exports = { view, MAX_ITEMS };
