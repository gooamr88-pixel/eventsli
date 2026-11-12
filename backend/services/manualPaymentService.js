const { supabase } = require('../config/supabase');
const { describeOrder, FEE_BEARER, PAYMENT_FEE_MODE } = require('../utils/money');
const invoices_ = require('./invoiceService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sales the organizer took themselves (BRD §03, §18, §20).
 *
 * They collected the money; we never saw it. What we have is a RECEIVABLE — the
 * commission on that sale — which becomes an invoice, and an unpaid invoice
 * closes the gate for that event.
 *
 * The commission is computed HERE, from the event's own rates and the seats
 * actually sold, exactly as it is for a card sale. An organizer telling us what
 * they owe is not a number worth storing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * What a manual sale of these seats is worth.
 *
 * No payment fee: there was no card, so there is no processing cost to recover.
 * Charging one anyway would be inventing a fee out of a cost we did not incur.
 */
async function priceManualSale({ eventId, seatIds, tableId }) {
  const { data: event } = await supabase
    .from('events')
    .select('id, currency, status, commission_pct, commission_tax_pct, event_tax_pct')
    .eq('id', eventId)
    .maybeSingle();

  if (!event) throw fail('EVENT_NOT_FOUND', 'That event does not exist.');

  let subtotalCents = 0;
  let seats = [...new Set(seatIds || [])];

  /**
   * Every table and seat is looked up THROUGH THIS EVENT'S MAP.
   *
   * They were looked up by id alone. Table and seat ids are public — every
   * published seat map carries them — so an organizer could price, and then
   * record as sold, a competitor's seats from their own dashboard. The error
   * message already said "not part of this event"; nothing checked it.
   * `record_manual_sale` refuses the same thing on its own, so this is not the
   * only guard.
   */
  if (tableId) {
    const { data: table, error: tableError } = await supabase
      .from('tables')
      .select('id, price_cents, status, venue_maps!inner ( event_id )')
      .eq('id', tableId)
      .eq('venue_maps.event_id', eventId)
      .maybeSingle();
    if (tableError) throw fail('CONFLICT', 'That table could not be checked. Try again.');
    if (!table) throw fail('NOT_FOUND', 'That table is not part of this event.');
    if (table.price_cents === null) {
      throw fail('VALIDATION_ERROR', 'That table has no price set.');
    }
    subtotalCents = Number(table.price_cents);

    const { data: tableSeats } = await supabase
      .from('seats').select('id').eq('table_id', tableId);
    seats = (tableSeats || []).map((s) => s.id);
  } else {
    if (!seats.length) throw fail('VALIDATION_ERROR', 'Choose the seats that were sold.');
    const { data: rows, error: seatError } = await supabase
      .from('seats')
      .select('id, price_override_cents, ticket_tiers ( price_cents ), venue_maps!inner ( event_id )')
      .in('id', seats)
      .eq('venue_maps.event_id', eventId);
    if (seatError) throw fail('CONFLICT', 'Those seats could not be checked. Try again.');
    if ((rows || []).length !== seats.length) {
      throw fail('NOT_FOUND', 'Some of those seats are not part of this event.');
    }
    /**
     * AN UNPRICED SEAT IS REFUSED, the same as an unpriced table is six lines
     * above — and until now only the table was.
     *
     * The `?? 0` that used to close this reduce is the JavaScript twin of the
     * `COALESCE(..., 0)` at the bottom of `seat_price_cents`, and it has the
     * same two meanings folded into one number: a seat that costs nothing, and
     * a seat that was never given a price. On the door-sales screen the second
     * one is an organizer recording a cash sale and being told the commission
     * is zero, which is both a wrong number and a story their own books will
     * disagree with.
     *
     * A ticket type priced at 0 still passes: `price_cents` is 0, not absent.
     */
    const unpriced = (rows || []).filter(
      (s) => s.price_override_cents === null
        && (s.ticket_tiers?.price_cents === null || s.ticket_tiers?.price_cents === undefined),
    ).length;
    if (unpriced > 0) {
      throw fail('SEAT_NOT_PRICED',
        `${unpriced} of those seats ${unpriced === 1 ? 'has' : 'have'} no price set. `
        + 'Attach a ticket type to them on the seating map first — a type priced at zero '
        + 'is fine, no type at all is not.');
    }

    subtotalCents = (rows || []).reduce(
      (sum, s) => sum + Number(s.price_override_cents ?? s.ticket_tiers.price_cents), 0,
    );
  }

  const breakdown = describeOrder({
    faceCents: subtotalCents,
    quantity: 1,
    eventTaxPct: Number(event.event_tax_pct),
    commissionPct: Number(event.commission_pct),
    commissionTaxPct: Number(event.commission_tax_pct),
    // No card was used, so nothing is recovered and nothing is charged.
    paymentFeeMode: PAYMENT_FEE_MODE.MANUAL,
    paymentFeePct: 0,
    paymentFeeFixedCents: 0,
    feeBearer: FEE_BEARER.ORGANIZER,
    stripe: { pct: 0, fixedCents: 0 },
  });

  return { event, breakdown, seatCount: seats.length };
}

async function recordSale({ eventId, seatIds, tableId, buyer, method, note, recordedBy }) {
  const { breakdown } = await priceManualSale({ eventId, seatIds, tableId });

  const { data, error } = await supabase.rpc('record_manual_sale', {
    p_event_id: eventId,
    p_seat_ids: tableId ? null : [...new Set(seatIds || [])],
    p_table_id: tableId || null,
    p_breakdown: breakdown,
    p_buyer: buyer,
    p_method: method,
    p_note: note || null,
    p_recorded_by: recordedBy,
  });

  if (error) throw fail('CONFLICT', error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message || 'That sale could not be recorded.');
  return data;
}

/**
 * What the organizer owes on this event, every invoice with its payments and
 * history, and what that means for the door.
 */
async function debtFor(eventId) {
  const { data: event } = await supabase
    .from('events').select('id, currency, title, starts_at').eq('id', eventId).maybeSingle();
  if (!event) throw fail('EVENT_NOT_FOUND', 'That event does not exist.');

  const [{ data: owed }, { data: invoices, error }, { data: gate }, { data: setting }] = await Promise.all([
    supabase.rpc('manual_commission_owed', { p_event_id: eventId, p_currency: event.currency }),
    supabase.from('invoices')
      .select(invoices_.INVOICE_COLUMNS)
      .eq('event_id', eventId).order('issued_at', { ascending: false }),
    supabase.rpc('scanner_is_locked', { p_event_id: eventId }),
    supabase.from('platform_settings').select('value').eq('key', 'manual_invoice').maybeSingle(),
  ]);
  if (error) throw new Error(error.message);

  const owedCents = Number(owed || 0);
  const rows = invoices || [];
  const { payments, history } = await invoices_.organizerHistory(rows.map((i) => i.id));
  const shaped = rows.map((i) => ({
    ...invoices_.shapeInvoice(i),
    payments: payments.get(i.id) || [],
    history: history.get(i.id) || [],
  }));
  // Balances, not face amounts: a part-paid invoice's payments already reduced
  // what the ledger says is owed.
  const unpaidCents = shaped
    .filter((i) => invoices_.UNPAID.includes(i.status))
    .reduce((sum, i) => sum + i.balanceCents, 0);
  const instructions = setting?.value?.payment_instructions;

  return {
    currency: event.currency,
    owedCents,
    // Commission on door sales that no invoice asks for yet. Shown so the
    // organizer is not surprised by the next invoice — or left wondering why
    // "Outstanding" is more than the invoices add up to.
    uninvoicedCents: Math.max(owedCents - unpaidCents, 0),
    // Surfaced together on purpose: the organizer needs to see the debt and the
    // consequence in one place, not discover the second at the door.
    gate,
    // How to pay Eventsli. Null until an admin sets it (Platform settings).
    paymentInstructions: typeof instructions === 'string' && instructions.trim() ? instructions.trim() : null,
    invoices: shaped,
  };
}

// Kept as this module's API — the routes and the tests call these — and
// delegated to services/invoiceService.js, where every invoice action lives.

async function raiseInvoice(eventId, adminId = null) {
  return invoices_.raise(eventId, adminId);
}

/**
 * The organizer says they have paid, and attaches evidence.
 *
 * This does NOT settle anything and does NOT reopen the gate (unless the
 * platform's policy pauses enforcement while a receipt is reviewed) — it puts
 * the invoice in front of an admin.
 */
async function submitProof({ invoiceId, organizerId, userId, proofUrl }) {
  await invoices_.submitReceipt({ invoiceId, organizerId, userId, proofUrl });
  const { data } = await supabase.from('invoices').select(invoices_.INVOICE_COLUMNS).eq('id', invoiceId).single();
  return invoices_.shapeInvoice(data);
}

async function settle({ invoiceId, adminId, note }) {
  return invoices_.settle({ invoiceId, adminId, note });
}

function fail(code, message, meta) {
  return Object.assign(new Error(message || code), { code, meta });
}

module.exports = { priceManualSale, recordSale, debtFor, raiseInvoice, submitProof, settle };
