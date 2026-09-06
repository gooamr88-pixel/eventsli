const { supabase } = require('../config/supabase');
const { describeOrder, FEE_BEARER, PAYMENT_FEE_MODE } = require('../utils/money');

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
  let seats = seatIds || [];

  if (tableId) {
    const { data: table } = await supabase
      .from('tables').select('id, price_cents, status').eq('id', tableId).maybeSingle();
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
    const { data: rows } = await supabase
      .from('seats')
      .select('id, price_override_cents, ticket_tiers ( price_cents )')
      .in('id', seats);
    subtotalCents = (rows || []).reduce(
      (sum, s) => sum + Number(s.price_override_cents ?? s.ticket_tiers?.price_cents ?? 0), 0,
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
    p_seat_ids: tableId ? null : seatIds,
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

/** What the organizer owes on this event, and the state of any invoice. */
async function debtFor(eventId) {
  const { data: event } = await supabase
    .from('events').select('id, currency, title, starts_at').eq('id', eventId).maybeSingle();
  if (!event) throw fail('EVENT_NOT_FOUND', 'That event does not exist.');

  const [{ data: owed }, { data: invoices }, { data: gate }] = await Promise.all([
    supabase.rpc('manual_commission_owed', { p_event_id: eventId, p_currency: event.currency }),
    supabase.from('invoices')
      .select('id, number, currency, amount_cents, status, issued_at, due_at, proof_url, proof_submitted_at, confirmed_at, order_count')
      .eq('event_id', eventId).order('issued_at', { ascending: false }),
    supabase.rpc('scanner_is_locked', { p_event_id: eventId }),
  ]);

  return {
    currency: event.currency,
    owedCents: Number(owed || 0),
    // Surfaced together on purpose: the organizer needs to see the debt and the
    // consequence in one place, not discover the second at the door.
    gate,
    invoices: (invoices || []).map(shapeInvoice),
  };
}

function shapeInvoice(i) {
  return {
    id: i.id,
    number: i.number,
    currency: i.currency,
    amountCents: i.amount_cents,
    status: i.status,
    issuedAt: i.issued_at,
    dueAt: i.due_at,
    orderCount: i.order_count,
    proofUrl: i.proof_url,
    proofSubmittedAt: i.proof_submitted_at,
    confirmedAt: i.confirmed_at,
    // Computed rather than read from `status`: the label is set by a scheduled
    // job, and between runs a due invoice still says "open" while the gate is
    // already shut. The organizer should see the same truth the door does.
    isOverdue: ['open', 'submitted'].includes(i.status) && new Date(i.due_at) < new Date(),
  };
}

async function raiseInvoice(eventId) {
  const { data, error } = await supabase.rpc('raise_commission_invoice', { p_event_id: eventId });
  if (error) throw fail('CONFLICT', error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message, data);
  return data;
}

/**
 * The organizer says they have paid, and attaches evidence.
 *
 * This does NOT settle anything and does NOT reopen the gate — it moves the
 * invoice to `submitted` and puts it in front of an admin. Reopening on the
 * claim alone would make the proof decorative.
 */
async function submitProof({ invoiceId, organizerId, proofUrl }) {
  const { data, error } = await supabase
    .from('invoices')
    .update({
      status: 'submitted',
      proof_url: proofUrl,
      proof_submitted_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('organizer_id', organizerId)      // scoped: not someone else's invoice
    .in('status', ['open', 'overdue'])    // and not one already settled
    .select('id, status, proof_submitted_at')
    .single();

  if (error || !data) throw fail('CONFLICT', 'That invoice cannot be updated.');
  return shapeInvoice({ ...data, amount_cents: 0, due_at: new Date().toISOString() });
}

async function settle({ invoiceId, adminId, note }) {
  const { data, error } = await supabase.rpc('settle_invoice', {
    p_invoice_id: invoiceId, p_admin_id: adminId, p_note: note || null,
  });
  if (error) throw fail('CONFLICT', error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message);
  return data;
}

function fail(code, message, meta) {
  return Object.assign(new Error(message || code), { code, meta });
}

module.exports = { priceManualSale, recordSale, debtFor, raiseInvoice, submitProof, settle };
