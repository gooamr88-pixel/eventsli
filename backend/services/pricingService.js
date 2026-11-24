const { supabase } = require('../config/supabase');
const { addressLine, addressParts } = require('../utils/venueAddress');
// Every fee is worked out in the fees file (2026-11-24); this only gathers
// what was held and hands it over.
const {
  CHARGE_MODEL, FEE_BEARER, EVENT_FEE_COLUMNS, feesFromEvent, priceSale,
} = require('../utils/fees');
const { stripeCostModel } = require('./feeService');
const promo = require('./promoService');

/**
 * Turns a held reservation into the exact amounts to charge.
 *
 * THE PRICE IS NEVER TAKEN FROM THE CLIENT. Everything below is read from the
 * database at the moment of quoting: the seats that were actually held, their
 * resolved prices, and the event's own rates. A checkout that trusted a posted
 * total would let anyone buy a $500 table for a dollar, and the request would
 * look completely ordinary in the logs.
 */


/**
 * @returns {{ breakdown, event, reservation, items }} — or throws with a code.
 */
async function quoteReservation(reservationId, { chargeModel = CHARGE_MODEL.DIRECT, offline = false } = {}) {
  // Every read below checks its error (TECH-AUDIT-LOG S-17). A failed read is
  // not an absent row: the promo read in particular, ignored, priced a hold
  // WITHOUT the buyer's code — a full-price charge they had been shown less for.
  const { data: res, error: resError } = await supabase
    .from('reservations')
    // created_at feeds `heldForMs`; without it the hold screen told every
    // buyer "Finish within 1 minutes" on a 35-minute hold.
    .select('id, event_id, user_id, state, expires_at, created_at')
    .eq('id', reservationId)
    .maybeSingle();
  if (resError) throw new Error(`quote: reservation lookup failed: ${resError.message}`);

  if (!res) throw fail('RESERVATION_NOT_FOUND', 'That hold no longer exists.');

  if (res.state !== 'active') {
    throw fail('RESERVATION_EXPIRED',
      'Your seats were released. Please choose them again.');
  }
  // Checked here as well as by the sweeper: the sweeper runs on a schedule, so
  // between runs an expired hold is still `active` in the table.
  if (new Date(res.expires_at) <= new Date()) {
    throw fail('RESERVATION_EXPIRED', 'Your hold has expired. Please choose your seats again.');
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(`id, slug, title, status, currency, organizer_id, venue_name, starts_at, timezone,
             cover_url, ends_at, venue_address, city, venue_address_line2, venue_region, venue_postal_code, venue_directions,
             ${EVENT_FEE_COLUMNS},
             organizers ( display_name )`)
    .eq('id', res.event_id)
    .single();
  if (eventError) throw new Error(`quote: event lookup failed: ${eventError.message}`);

  if (event.status !== 'published') {
    throw fail('EVENT_NOT_PUBLISHED', 'This event is no longer on sale.');
  }

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * `quantity` IS SELECTED, AND BOTH SUMS BELOW MULTIPLY BY IT.
   *
   * General admission made `reservation_items.quantity` meaningful. A seat line
   * is always one ticket, so every sum written before GA existed ignored the
   * column and was right by accident; a GA line is "4 × Early bird" in ONE row.
   *
   * This function kept ignoring it, which made it the one place where the
   * quantity silently vanished — and it is the place that decides what Stripe
   * charges. Four GA tickets were quoted, charged and settled as one. The
   * database had it right the whole time (`hold_general` sums
   * `unit_price_cents * quantity`); only the quote disagreed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: items, error: itemsError } = await supabase
    .from('reservation_items')
    .select('id, seat_id, table_id, tier_id, unit_price_cents, quantity')
    .eq('reservation_id', reservationId);
  if (itemsError) throw new Error(`quote: item lookup failed: ${itemsError.message}`);

  if (!items || items.length === 0) {
    throw fail('RESERVATION_NOT_FOUND', 'That hold has nothing in it.');
  }

  const qtyOf = (i) => Math.max(1, Number(i.quantity) || 1);

  const ticketSubtotalCents = items.reduce(
    (sum, i) => sum + Number(i.unit_price_cents) * qtyOf(i), 0,
  );

  /**
   * ADD-ONS (2026-11-17) join the subtotal, at the price the buyer chose them
   * at, so every fee, tax and commission below applies to them exactly as to
   * the tickets — the owner's rule — and every fulfilment, which writes the
   * order from this quote, charges and records them without a change of its
   * own. Which tickets carry them is the database trigger's job.
   */
  const addons = await require('./addonService').forReservation(reservationId);
  const addonsCents = addons.reduce((sum, a) => sum + a.amountCents, 0);
  const subtotalCents = ticketSubtotalCents + addonsCents;

  // How many people this admits — a whole-table item is one line at one price
  // but seats the whole table, and that is the number the buyer counts. A GA
  // line admits its quantity: it has neither a seat nor a table behind it, so
  // before this it counted as nobody and the checkout read "Admits 0 people".
  const tableIds = items.filter((i) => i.table_id).map((i) => i.table_id);
  let admits = items
    .filter((i) => i.seat_id || (!i.table_id && i.tier_id))
    .reduce((n, i) => n + (i.seat_id ? 1 : qtyOf(i)), 0);
  // Per table, so a free table and a paid one count apart (the fixed
  // commission is per PAID ticket, 2026-11-24).
  const seatsAtTable = new Map();
  if (tableIds.length > 0) {
    // The seats THIS hold has, which are the seats the order will issue
    // (fulfill_checkout issues a table's seats by `held_by_reservation`, T-017).
    const { data: heldSeats, error: countError } = await supabase
      .from('seats').select('table_id')
      .in('table_id', tableIds).eq('held_by_reservation', reservationId);
    if (countError) throw new Error(`quote: seat count failed: ${countError.message}`);
    for (const s of heldSeats || []) seatsAtTable.set(s.table_id, (seatsAtTable.get(s.table_id) || 0) + 1);
    admits += (heldSeats || []).length;
  }
  // THE PAID TICKETS in this order — what the fixed part of the commission is
  // counted on: a seat is one, a general-admission line its quantity, a whole
  // table its seats; a line priced at zero is none.
  const paidTickets = items.reduce((n, i) => {
    if (!(Number(i.unit_price_cents) > 0)) return n;
    if (i.seat_id) return n + 1;
    if (i.table_id) return n + (seatsAtTable.get(i.table_id) || 1);
    return n + qtyOf(i);
  }, 0);

  // Claimed at HOLD time, not at payment. A code with a use limit is stock the
  // way a seat is: counted only at the charge, ten people at the checkout screen
  // with its last use all get it and nine are charged the wrong amount.
  const claimed = await promo.forReservation(reservationId);

  // OFFLINE (phase 2): the buyer pays the organizer directly, so there is no
  // card cost to recover and no payment fee — priced exactly as a door sale is
  // (manualPaymentService.priceManualSale). Commission and tax are unchanged.
  const fees = feesFromEvent(event, { channel: offline ? 'offline' : 'card' });
  const stripe = offline ? { pct: 0, fixedCents: 0 } : await stripeCostModel();

  // A card sale is a DIRECT charge on the organizer's own account
  // (TECH-AUDIT-LOG T-074): our fee is the commission and its tax; Stripe's
  // fee is the organizer's. DESTINATION only for a legacy session opened by
  // the previous release on the platform account and paid after this one went
  // live (checkoutController.fulfillFromSession). Offline: `priceSale` prices
  // it without a card.
  const breakdown = priceSale({
    fees,
    subtotalCents,
    paidTickets,
    discountCents: claimed?.discountCents || 0,
    stripe,
    chargeModel,
  });

  // WHAT THE PAYMENT FEE WAS WORKED OUT FROM, for the note under the buyer's
  // "Card processing fee" line (owner, 2026-11-19). Auto mode recovers
  // Stripe's own cost, so the note quotes Stripe's rate; manual mode uses the
  // rate an admin set, so the note quotes that instead. Never one for the other.
  const manualFee = offline || event.payment_fee_mode === 'manual';
  const paymentFeeBasis = offline ? null : {
    mode: manualFee ? 'manual' : 'auto',
    pct: manualFee ? Number(event.payment_fee_pct) : Number(stripe.pct),
    fixedCents: manualFee ? Number(event.payment_fee_fixed_cents) : Number(stripe.fixedCents),
  };

  return {
    breakdown: { ...breakdown, quantity: admits },
    paymentFeeBasis,
    ticketSubtotalCents,
    addons,
    event,
    reservation: res,
    items,
    admits,
    promo: claimed,
  };
}

/** The shape the checkout screen shows. Every line the buyer pays for (BRD §04, §21). */
function publicBreakdown(q) {
  const b = q.breakdown;
  const lines = [
    // The tickets alone, then each add-on on its own line (2026-11-17), so the
    // buyer sees exactly what the extras cost. A quote from before add-ons
    // existed has no `ticketSubtotalCents`; then the subtotal is all tickets.
    { label: 'Tickets', amountCents: q.ticketSubtotalCents ?? b.subtotalCents },
    ...(q.addons || []).map((a) => ({ label: `${a.name} × ${a.quantity}`, amountCents: a.amountCents, addon: true })),
  ];
  if (b.discountCents > 0) {
    // Named on the receipt. A bare "Discount" line makes a buyer wonder whether
    // their code was the one that applied.
    lines.push({
      label: q.promo?.code ? `Discount (${q.promo.code})` : 'Discount',
      amountCents: -b.discountCents,
    });
  }
  if (b.eventTaxCents > 0) lines.push({ label: 'Tax', amountCents: b.eventTaxCents });
  // Shown only when the buyer is the one paying it. When the organizer absorbs
  // it, putting it on the buyer's receipt as a zero would just raise questions.
  //
  // "Card processing fee", not "Service fee" (owner, 2026-11-19): it is the
  // card payment's cost, and the buyer asked what it was. `basis` carries the
  // rate it was worked out from, for the note under the line. The rate is not
  // printed AS the amount: in auto mode Stripe takes its percentage of the
  // whole payment, fee included, so the fee is slightly more than that
  // percentage of the tickets, and "2.9%" beside it would not add up.
  if (b.feeBearer === FEE_BEARER.BUYER && b.paymentFeeCents > 0) {
    lines.push({
      label: 'Card processing fee',
      amountCents: b.paymentFeeCents,
      ...(q.paymentFeeBasis ? { basis: q.paymentFeeBasis } : {}),
    });
  }

  /**
   * How long this hold was issued FOR, not how long is left.
   *
   * The countdown already knows the deadline; what it cannot work out is the
   * fraction remaining, which is what draws the ring on the hold screen. Sent
   * as a duration rather than a start time so no client has to subtract two
   * timestamps and get the sign wrong.
   *
   * Falls back to null rather than to a guessed 35 minutes: a ring drawn
   * against an assumed window is a ring that lies, and the figure inside it is
   * the part that matters anyway.
   */
  const created = q.reservation.created_at ? new Date(q.reservation.created_at).getTime() : null;
  const expires = new Date(q.reservation.expires_at).getTime();
  const heldForMs = created && expires > created ? expires - created : null;

  return {
    currency: q.event.currency,
    admits: q.admits,
    lines,
    // What the hold carries, for the checkout's add-on picker to start from.
    addons: (q.addons || []).map((a) => ({ addonId: a.addonId, name: a.name, quantity: a.quantity, unitPriceCents: a.unitPriceCents })),
    totalCents: b.buyerTotalCents,
    expiresAt: q.reservation.expires_at,
    heldForMs,
    // Enough to show WHAT is being held, so the buyer confirming a hold is not
    // looking at a price with no event attached to it. Deliberately not the
    // whole event: this is a checkout, not a listing.
    event: {
      slug: q.event.slug,
      // Named in the SMS marketing checkbox: "offers from <organizer>".
      organizerName: q.event.organizers?.display_name || null,
      title: q.event.title,
      venue: q.event.venue_name || null,
      startsAt: q.event.starts_at || null,
      // Sent WITH `startsAt`, never without it. A checkout that renders the
      // start time in the reader's own zone tells somebody in Vancouver that a
      // Toronto show at 8pm is at 5pm — the event page, the ticket and the door
      // all say 8pm, so the one screen that disagrees is the one taking money.
      // The client cannot recover this after the fact, so it travels with the
      // timestamp it qualifies.
      timezone: q.event.timezone || null,
      // For the checkout's order summary (2026-11-15): the poster, when it
      // ends, and where exactly. Display only — nothing priced reads them.
      coverUrl: q.event.cover_url || null,
      endsAt: q.event.ends_at || null,
      venueAddress: q.event.venue_address || null,
      city: q.event.city || null,
      venueAddressFull: addressLine(q.event),
      venueDirections: addressParts(q.event).directions,
    },
  };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

// `stripeCostModel` lives in feeService; re-exported for older imports.
module.exports = { quoteReservation, publicBreakdown, stripeCostModel };
