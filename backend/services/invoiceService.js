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
  'id', 'number', 'currency', 'amount_cents', 'paid_cents', 'written_off_cents', 'status',
  'issued_at', 'due_at', 'due_at_original', 'order_count', 'covers_from', 'covers_to',
  'proof_url', 'proof_submitted_at', 'receipt_rejected_at', 'receipt_rejection_reason',
  'confirmed_at', 'reminder_sent_at', 'overdue_notified_at',
  'waived_at', 'waive_reason', 'voided_at', 'void_reason', 'event_id', 'organizer_id',
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
  const { paid, writtenOff, balance } = invoiceMoney(i);
  return {
    id: i.id,
    number: i.number,
    currency: i.currency,
    amountCents: Number(i.amount_cents),
    paidCents: paid,
    writtenOffCents: writtenOff,
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
      ...(detail.url && admin ? { url: detail.url } : {}),
    },
    ...(admin ? { actor: e.actor?.full_name || e.actor?.email || null } : {}),
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

  const [payments, events, gate] = await Promise.all([
    supabase.from('invoice_payments')
      .select('*, recorded_by_profile:profiles!invoice_payments_recorded_by_fkey ( full_name, email )')
      .eq('invoice_id', invoiceId).order('recorded_at', { ascending: true }),
    supabase.from('invoice_events')
      .select('*, actor:profiles!invoice_events_actor_id_fkey ( full_name, email )')
      .eq('invoice_id', invoiceId).order('created_at', { ascending: true }),
    supabase.rpc('scanner_is_locked', { p_event_id: invoice.event_id }),
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

const recordPayment = ({ invoiceId, amountCents, method, reference, receivedAt, note, adminId }) => call('invoice_record_payment', {
  p_invoice_id: invoiceId,
  p_amount_cents: amountCents,
  p_method: method || null,
  p_reference: reference || null,
  p_received_at: receivedAt || null,
  p_note: note || null,
  p_admin_id: adminId,
});

const reversePayment = ({ paymentId, reason, adminId }) => call('invoice_reverse_payment', {
  p_payment_id: paymentId, p_reason: reason, p_admin_id: adminId,
});

const waive = ({ invoiceId, reason, adminId }) => call('invoice_waive', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });
const reopen = ({ invoiceId, reason, adminId }) => call('invoice_reopen', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });
const voidInvoice = ({ invoiceId, reason, adminId }) => call('invoice_void', { p_invoice_id: invoiceId, p_reason: reason, p_admin_id: adminId });

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
  raise, submitReceipt, settle, recordPayment, reversePayment, waive, reopen, voidInvoice,
  setDueDate, rejectReceipt, addNote, logReminder, fail,
};
