const { supabase } = require('../config/supabase');
const { isInvoiceOverdue, invoiceMoney } = require('../utils/invoices');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * COMMISSION INVOICES — every action an admin or organizer can take on one.
 *
 * Each action is ONE database function (migration 20261115090000) that locks
 * the invoice, checks the action is allowed in its current state, writes the
 * ledger, the payment record and the invoice's history, and re-derives the
 * status — atomically. This module only translates: arguments in, the
 * function's `{ ok, error, message }` out as a coded error or the invoice as
 * it now stands.
 *
 * Nothing here edits an invoice row directly. A status set from JavaScript is
 * how the old receipt upload forgot to clear a rejection, and how a settle
 * could disagree with the ledger.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const UNPAID = ['open', 'submitted', 'overdue'];

const INVOICE_COLUMNS = [
  'id', 'number', 'currency', 'amount_cents', 'paid_cents', 'written_off_cents', 'credited_cents', 'status',
  'issued_at', 'due_at', 'due_at_original', 'order_count', 'covers_from', 'covers_to',
  'proof_url', 'proof_submitted_at', 'receipt_rejected_at', 'receipt_rejection_reason',
  'confirmed_at', 'reminder_sent_at', 'overdue_notified_at',
  'waived_at', 'waive_reason', 'voided_at', 'void_reason', 'event_id', 'organizer_id',
  // Frozen at issue (20261123100000): the line items and who it is from/to.
  'sales_count', 'sales_gross_cents', 'commission_cents', 'commission_tax_cents', 'adjustment_cents',
  'issuer', 'recipient',
].join(', ');

function fail(code, message, meta) {
  return Object.assign(new Error(message || code), { code, meta });
}

/** Calls an invoice function; its refusal becomes a coded error. */
async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw fail('CONFLICT', error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message || 'That could not be done.', data);
  return data;
}

function shapeInvoice(i) {
  const { paid, writtenOff, credited, balance } = invoiceMoney(i);
  return {
    id: i.id,
    number: i.number,
    currency: i.currency,
    amountCents: Number(i.amount_cents),
    paidCents: paid,
    writtenOffCents: writtenOff,
    // Taken off by credit notes for sales voided or refunded after issue.
    creditedCents: credited,
    balanceCents: balance,
    status: i.status,
    issuedAt: i.issued_at,
    dueAt: i.due_at,
    // Set when an admin moved the due date; the date first communicated.
    originalDueAt: i.due_at_original && i.due_at_original !== i.due_at ? i.due_at_original : null,
    orderCount: i.order_count,
    proofUrl: i.proof_url,
    proofSubmittedAt: i.proof_submitted_at,
    receiptRejectedAt: i.receipt_rejected_at || null,
    receiptRejectionReason: i.receipt_rejection_reason || null,
    confirmedAt: i.confirmed_at,
    waivedAt: i.waived_at || null,
    waiveReason: i.waive_reason || null,
    voidedAt: i.voided_at || null,
    voidReason: i.void_reason || null,
    reminderSentAt: i.reminder_sent_at || null,
    // Computed, not read from `status`: between runs of the hourly job a due
    // invoice still says "open" while it already counts against the gate.
    isOverdue: isInvoiceOverdue(i),
    // The invoice document (20261123100000). Null on invoices raised before
    // itemisation existed; the page says so rather than inventing lines.
    lines: i.commission_cents === null || i.commission_cents === undefined ? null : {
      salesCount: Number(i.sales_count || 0),
      salesGrossCents: Number(i.sales_gross_cents || 0),
      commissionCents: Number(i.commission_cents),
      commissionTaxCents: Number(i.commission_tax_cents || 0),
      adjustmentCents: Number(i.adjustment_cents || 0),
    },
    coversFrom: i.covers_from || null,
    coversTo: i.covers_to || null,
    issuer: i.issuer && Object.keys(i.issuer).length ? i.issuer : null,
    recipient: i.recipient || null,
  };
}

function shapePayment(p, { admin = false } = {}) {
  return {
    id: p.id,
    amountCents: Number(p.amount_cents),
    currency: p.currency,
    method: p.method,
    reference: p.reference,
    receivedAt: p.received_at,
    recordedAt: p.recorded_at,
    reversedAt: p.reversed_at,
    reversalReason: p.reversal_reason,
    ...(admin ? { note: p.note, recordedBy: p.recorded_by_profile?.full_name || p.recorded_by_profile?.email || null } : {}),
  };
}

/**
 * What the organizer sees of an invoice's history. Internal notes are an
 * admin's working notes and are left out, as is who on the team acted.
 */
const ORGANIZER_KINDS = new Set([
  'raised', 'reminder_sent', 'overdue', 'receipt_submitted', 'receipt_rejected', 'due_changed',
  'payment_recorded', 'payment_reversed', 'settled', 'waived', 'reopened', 'voided',
  'credited', 'credit_released',
]);

function shapeEvent(e, { admin = false } = {}) {
  const detail = e.detail || {};
  return {
    id: e.id,
    kind: e.kind,
    at: e.created_at,
    amountCents: e.amount_cents === null || e.amount_cents === undefined ? null : Number(e.amount_cents),
    // A payment's note can be an admin's working note; the organizer is shown
    // the reasons that are addressed to them (rejection, waiver, new date…).
    note: admin || e.kind !== 'payment_recorded' ? e.note : null,
    actorRole: e.actor_role,
    detail: {
      ...(detail.from ? { from: detail.from } : {}),
      ...(detail.to ? { to: detail.to } : {}),
      ...(detail.method ? { method: detail.method } : {}),
      ...(detail.reference ? { reference: detail.reference } : {}),
      ...(detail.received_at ? { receivedAt: detail.received_at } : {}),
      ...(detail.credit_note_number ? { creditNoteNumber: detail.credit_note_number } : {}),
      ...(detail.url && admin ? { url: detail.url } : {}),
    },
    ...(admin ? { actor: e.actor?.full_name || e.actor?.email || null } : {}),
  };
}

// ─── Credit notes (20261123110000) ───────────────────────────────────────────

const CREDIT_NOTE_COLUMNS = 'id, number, event_id, invoice_id, order_id, currency, commission_cents, '
  + 'commission_tax_cents, amount_cents, remaining_cents, kind, reason, issuer, recipient, created_at, '
  + 'credit_note_allocations ( id, invoice_id, kind, amount_cents, from_write_off, method, reference, created_at, '
  + 'invoice:invoices!credit_note_allocations_invoice_id_fkey ( number ) )';

/**
 * A credit note and where its money went. `appliedCents` is the net amount it
 * took off `forInvoiceId` (applied less released), when one is given.
 */
function shapeCreditNote(n, { forInvoiceId = null } = {}) {
  const allocations = [...(n.credit_note_allocations || [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((a) => ({
      kind: a.kind,
      invoiceId: a.invoice_id,
      invoiceNumber: a.invoice?.number || null,
      amountCents: Number(a.amount_cents),
      fromWriteOff: Boolean(a.from_write_off),
      at: a.created_at,
      ...(a.kind === 'refunded' ? { method: a.method, reference: a.reference } : {}),
    }));
  const appliedCents = forInvoiceId ? allocations
    .filter((a) => a.invoiceId === forInvoiceId && (a.kind === 'applied' || a.kind === 'released'))
    .reduce((s, a) => s + (a.kind === 'released' ? -a.amountCents : a.amountCents), 0) : null;
  return {
    id: n.id,
    number: n.number,
    issuedAt: n.created_at,
    kind: n.kind,
    // The organizer's own words when they voided the sale; an admin's when they did.
    reason: n.reason,
    currency: n.currency,
    commissionCents: Number(n.commission_cents),
    commissionTaxCents: Number(n.commission_tax_cents),
    amountCents: Number(n.amount_cents),
    remainingCents: Number(n.remaining_cents),
    invoiceId: n.invoice_id,
    orderId: n.order_id,
    issuer: n.issuer && Object.keys(n.issuer).length ? n.issuer : null,
    recipient: n.recipient || null,
    allocations,
    ...(forInvoiceId ? { appliedCents } : {}),
  };
}

async function creditNoteRows(eventId) {
  const { data, error } = await supabase.from('credit_notes')
    .select(CREDIT_NOTE_COLUMNS).eq('event_id', eventId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Every credit note on an event, oldest first. */
async function creditNotesForEvent(eventId) {
  return (await creditNoteRows(eventId)).map((n) => shapeCreditNote(n));
}

/** The credit notes that correct this invoice or were applied to it. */
async function creditNotesForInvoice(invoiceId, eventId) {
  return (await creditNoteRows(eventId))
    .filter((n) => n.invoice_id === invoiceId
      || (n.credit_note_allocations || []).some((a) => a.invoice_id === invoiceId))
    .map((n) => shapeCreditNote(n, { forInvoiceId: invoiceId }));
}

/** One credit note with its event and invoice number, for its document page. */
async function creditNote(creditNoteId) {
  const { data, error } = await supabase.from('credit_notes')
    .select(`${CREDIT_NOTE_COLUMNS}, organizer_id, corrects:invoices!credit_notes_invoice_id_fkey ( id, number ), events ( id, title, timezone )`)
    .eq('id', creditNoteId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That credit note does not exist.');
  return {
    creditNote: { ...shapeCreditNote(data), invoiceNumber: data.corrects?.number || null },
    event: data.events ? { id: data.events.id, title: data.events.title, timezone: data.events.timezone } : null,
    organizerId: data.organizer_id,
    eventId: data.event_id,
  };
}

/**
 * Whether an invoice may be issued to this organizer now:
 * { ok, issuerMissing: [...], organizerMissing: [...] } — field names.
 */
async function billingCheck(organizerId) {
  const { data, error } = await supabase.rpc('invoice_billing_check', { p_organizer_id: organizerId });
  if (error) throw new Error(error.message);
  return {
    ok: Boolean(data?.ok),
    issuerMissing: data?.issuer_missing || [],
    organizerMissing: data?.organizer_missing || [],
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Everything about one invoice, for the admin console. */
async function detail(invoiceId) {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`${INVOICE_COLUMNS}, events ( id, title, slug, starts_at, timezone, status, city, venue_name ), organizers ( id, display_name, profiles!organizers_owner_user_id_fkey ( email ) )`)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) throw fail('NOT_FOUND', 'That invoice does not exist.');

  const [payments, events, gate, credits] = await Promise.all([
    supabase.from('invoice_payments')
      .select('*, recorded_by_profile:profiles!invoice_payments_recorded_by_fkey ( full_name, email )')
      .eq('invoice_id', invoiceId).order('recorded_at', { ascending: true }),
    supabase.from('invoice_events')
      .select('*, actor:profiles!invoice_events_actor_id_fkey ( full_name, email )')
      .eq('invoice_id', invoiceId).order('created_at', { ascending: true }),
    supabase.rpc('scanner_is_locked', { p_event_id: invoice.event_id }),
    creditNotesForInvoice(invoice.id, invoice.event_id),
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (events.error) throw new Error(events.error.message);

  const org = invoice.organizers;
  const profile = Array.isArray(org?.profiles) ? org.profiles[0] : org?.profiles;
  return {
    invoice: shapeInvoice(invoice),
    event: invoice.events && {
      id: invoice.events.id, title: invoice.events.title, slug: invoice.events.slug,
      startsAt: invoice.events.starts_at, timezone: invoice.events.timezone,
      status: invoice.events.status, city: invoice.events.city, venue: invoice.events.venue_name,
    },
    organizer: org && { id: org.id, name: org.display_name, email: profile?.email || null },
    payments: (payments.data || []).map((p) => shapePayment(p, { admin: true })),
    history: (events.data || []).map((e) => shapeEvent(e, { admin: true })),
    creditNotes: credits,
    gate: gate.data || null,
    actions: allowedActions(invoice),
  };
}

/**
 * What an admin may do to this invoice now — the same rules the database
 * functions enforce, so the console never offers a button that will refuse.
 */
function allowedActions(i) {
  const unpaid = UNPAID.includes(i.status);
  const paid = Number(i.paid_cents) || 0;
  const writtenOff = Number(i.written_off_cents) || 0;
  return {
    recordPayment: unpaid,
    settle: unpaid,
    waive: unpaid,
    void: unpaid && paid === 0,
    changeDueDate: unpaid,
    rejectReceipt: i.status === 'submitted',
    reopen: writtenOff > 0,
    reversePayment: i.status !== 'void' && writtenOff === 0 && paid > 0,
    remind: unpaid,
    note: true,
  };
}

/** One invoice's payments and organizer-facing history, for the Commission page. */
async function organizerHistory(invoiceIds) {
  if (!invoiceIds.length) return { payments: new Map(), history: new Map() };
  const [payments, events] = await Promise.all([
    supabase.from('invoice_payments').select('*').in('invoice_id', invoiceIds).order('recorded_at'),
    supabase.from('invoice_events').select('*').in('invoice_id', invoiceIds)
      .in('kind', [...ORGANIZER_KINDS]).order('created_at'),
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (events.error) throw new Error(events.error.message);
  const group = (rows, shape) => rows.reduce((m, r) => {
    const list = m.get(r.invoice_id) || [];
    list.push(shape(r));
    m.set(r.invoice_id, list);
    return m;
  }, new Map());
  return {
    payments: group(payments.data || [], (p) => shapePayment(p)),
    history: group(events.data || [], (e) => shapeEvent(e)),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const raise = (eventId, adminId = null) => call('raise_commission_invoice', { p_event_id: eventId, p_admin_id: adminId });

const submitReceipt = ({ invoiceId, organizerId, userId, proofUrl }) => call('invoice_submit_receipt', {
  p_invoice_id: invoiceId, p_organizer_id: organizerId, p_user_id: userId || null, p_url: proofUrl,
});

const settle = ({ invoiceId, adminId, note }) => call('settle_invoice', {
  p_invoice_id: invoiceId, p_admin_id: adminId || null, p_note: note || null,
});

const recordPayment = ({ invoiceId, amountCents, method, reference, receivedAt, note, adminId, idempotencyKey }) => call('invoice_record_payment', {
  p_invoice_id: invoiceId,
  p_amount_cents: amountCents,
  p_method: method || null,
  p_reference: reference || null,
  p_received_at: receivedAt || null,
  p_note: note || null,
  p_admin_id: adminId,
  // The form's key (20261121100000): the same submission twice records once.
  p_idempotency_key: idempotencyKey || null,
});

const reversePayment = ({ paymentId, reason, adminId }) => call('invoice_reverse_payment', {
  p_payment_id: paymentId, p_reason: reason, p_admin_id: adminId,
});

const waive = ({ invoiceId, reason, adminId }) => call('invoice_waive', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });
const reopen = ({ invoiceId, reason, adminId }) => call('invoice_reopen', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });
const voidInvoice = ({ invoiceId, reason, adminId }) => call('invoice_void', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });

/** A credit balance paid back to the organizer (credit_note_refund). */
const refundCredit = ({ creditNoteId, amountCents, method, reference, note, adminId }) => call('credit_note_refund', {
  p_credit_note_id: creditNoteId, p_amount_cents: amountCents, p_method: method || null,
  p_reference: reference || null, p_note: note || null, p_admin_id: adminId,
});

const setDueDate = ({ invoiceId, dueAt, reason, adminId }) => call('invoice_set_due', {
  p_invoice_id: invoiceId, p_due_at: dueAt, p_reason: reason, p_admin_id: adminId,
});

const rejectReceipt = ({ invoiceId, reason, adminId }) => call('invoice_reject_receipt', {
  p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId,
});

const addNote = ({ invoiceId, note, adminId }) => call('invoice_add_note', {
  p_invoice_id: invoiceId, p_note: note, p_admin_id: adminId,
});

/** A reminder an admin sends by hand: recorded in the history like the job's. */
async function logReminder({ invoiceId, adminId }) {
  const { error } = await supabase.rpc('invoice_log', {
    p_invoice_id: invoiceId, p_kind: 'reminder_sent', p_role: 'admin', p_actor: adminId,
    p_amount: null, p_note: null, p_detail: { manual: true },
  });
  if (error) throw new Error(error.message);
}

/** The invoice's event id, for gate reads and notices. */
async function eventOf(invoiceId) {
  const { data } = await supabase.from('invoices').select('event_id').eq('id', invoiceId).maybeSingle();
  return data?.event_id || null;
}

module.exports = {
  UNPAID, INVOICE_COLUMNS, shapeInvoice, shapePayment, shapeEvent, allowedActions,
  detail, organizerHistory, eventOf,
  shapeCreditNote, creditNotesForEvent, creditNotesForInvoice, creditNote, billingCheck, refundCredit,
  raise, submitReceipt, settle, recordPayment, reversePayment, waive, reopen, voidInvoice,
  setDueDate, rejectReceipt, addNote, logReminder, fail,
};
