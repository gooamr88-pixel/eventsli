const { supabase } = require('../config/supabase');
const { describeOrder, FEE_BEARER, PAYMENT_FEE_MODE } = require('../utils/money');
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

async function stripeCostModel() {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'stripe_cost').maybeSingle();
  return {
    pct: Number(data?.value?.pct ?? process.env.STRIPE_FEE_PCT ?? 2.9),
    fixedCents: Number(data?.value?.fixed_cents ?? process.env.STRIPE_FEE_FIXED_CENTS ?? 30),
  };
}

/**
 * @returns {{ breakdown, event, reservation, items }} — or throws with a code.
 */
async function quoteReservation(reservationId) {
  const { data: res } = await supabase
    .from('reservations')
    .select('id, event_id, user_id, state, expires_at')
    .eq('id', reservationId)
    .maybeSingle();

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

  const { data: event } = await supabase
    .from('events')
    .select(`id, slug, title, status, currency, organizer_id,
             commission_pct, commission_tax_pct, event_tax_pct,
             payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, fee_bearer`)
    .eq('id', res.event_id)
    .single();

  if (event.status !== 'published') {
    throw fail('EVENT_NOT_PUBLISHED', 'This event is no longer on sale.');
  }

  const { data: items } = await supabase
    .from('reservation_items')
    .select('id, seat_id, table_id, tier_id, unit_price_cents')
    .eq('reservation_id', reservationId);

  if (!items || items.length === 0) {
    throw fail('RESERVATION_NOT_FOUND', 'That hold has nothing in it.');
  }

  const subtotalCents = items.reduce((sum, i) => sum + Number(i.unit_price_cents), 0);

  // How many people this admits — a whole-table item is one line at one price
  // but seats the whole table, and that is the number the buyer counts.
  const tableIds = items.filter((i) => i.table_id).map((i) => i.table_id);
  let admits = items.filter((i) => i.seat_id).length;
  if (tableIds.length > 0) {
    const { count } = await supabase
      .from('seats').select('id', { count: 'exact', head: true }).in('table_id', tableIds);
    admits += count || 0;
  }

  // Claimed at HOLD time, not at payment. A code with a use limit is stock the
  // way a seat is: counted only at the charge, ten people at the checkout screen
  // with its last use all get it and nine are charged the wrong amount.
  const claimed = await promo.forReservation(reservationId);

  const stripe = await stripeCostModel();

  // `quantity` stays 1: the fixed component of the payment fee mirrors Stripe's
  // per-CHARGE cost, and an order is one charge however many seats it holds.
  // Passing the seat count here would multiply that fixed fee by the party size.
  const breakdown = describeOrder({
    faceCents: subtotalCents,
    quantity: 1,
    eventTaxPct: Number(event.event_tax_pct),
    commissionPct: Number(event.commission_pct),
    commissionTaxPct: Number(event.commission_tax_pct),
    paymentFeeMode: event.payment_fee_mode === 'manual'
      ? PAYMENT_FEE_MODE.MANUAL : PAYMENT_FEE_MODE.AUTO,
    paymentFeePct: Number(event.payment_fee_pct),
    paymentFeeFixedCents: Number(event.payment_fee_fixed_cents),
    feeBearer: event.fee_bearer === 'organizer' ? FEE_BEARER.ORGANIZER : FEE_BEARER.BUYER,
    discountCents: claimed?.discountCents || 0,
    stripe,
  });

  return {
    breakdown: { ...breakdown, quantity: admits },
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
    { label: 'Tickets', amountCents: b.subtotalCents },
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
  if (b.feeBearer === FEE_BEARER.BUYER && b.paymentFeeCents > 0) {
    lines.push({ label: 'Service fee', amountCents: b.paymentFeeCents });
  }

  return {
    currency: q.event.currency,
    admits: q.admits,
    lines,
    totalCents: b.buyerTotalCents,
    expiresAt: q.reservation.expires_at,
  };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { quoteReservation, publicBreakdown, stripeCostModel };
