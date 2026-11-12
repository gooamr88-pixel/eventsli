const { supabase } = require('../config/supabase');
const email = require('./emailService');
const T = require('./emailTemplates');
const logger = require('../utils/logger');
const { loadForEmail, adminRecipients } = require('./eventPublishing');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO HEARS ABOUT A COMMISSION INVOICE, AND WHEN (BRD §18).
 *
 *   raised                  → organizer: amount, due date, how to pay, consequence
 *   due soon (once)         → organizer: reminder (scheduler, or an admin by hand)
 *   receipt uploaded        → every admin: money to check, maybe a gate shut
 *   fell due (once)         → organizer: what the door is now doing
 *   receipt rejected        → organizer: why, and what to do
 *   payment recorded        → organizer: received, and what is left (or settled)
 *   payment reversed        → organizer: why it no longer counts
 *   due date changed        → organizer: the new date, and why
 *   waived / voided / reopened → organizer: what changed, and why
 *   gate changed by an admin → organizer: scanning switched off / back on
 *
 * Everything here is best-effort and never throws: an action that happened
 * stands whether or not the email went (emailService.js says why). Each
 * function returns `{ sent }` for the caller to report.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const INVOICE_FIELDS = 'id, number, currency, amount_cents, paid_cents, written_off_cents, status, due_at, due_at_original, order_count, event_id, proof_url, proof_submitted_at, confirmed_at';

async function loadInvoice(invoiceId) {
  const { data, error } = await supabase.from('invoices').select(INVOICE_FIELDS).eq('id', invoiceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, balance_cents: Number(data.amount_cents) - Number(data.paid_cents || 0) - Number(data.written_off_cents || 0) };
}

/** The platform's "how to pay Eventsli" text, or null when an admin has not set it. */
async function paymentInstructions() {
  const { data, error } = await supabase
    .from('platform_settings').select('value').eq('key', 'manual_invoice').maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'invoice notice: could not read payment instructions');
    return null;
  }
  const text = data?.value?.payment_instructions;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/** Where the organizer sees this event's invoices and uploads a receipt. */
function commissionUrl(eventId) {
  const site = T.siteUrl();
  return site ? `${site}/organizer/events/${eventId}/commission` : null;
}

async function gateOf(eventId) {
  const { data, error } = await supabase.rpc('scanner_is_locked', { p_event_id: eventId });
  if (error) return null;
  return data;
}

async function context(invoiceId) {
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) return null;
  const info = await loadForEmail(invoice.event_id);
  if (!info) return null;
  return { invoice, info, url: commissionUrl(invoice.event_id) };
}

/** Runs `fn(ctx)`; logs and returns `{ sent: false }` instead of throwing. */
async function deliver(label, invoiceId, fn) {
  try {
    const ctx = await context(invoiceId);
    if (!ctx) return { sent: false, reason: 'not_found' };
    return (await fn(ctx)) || { sent: false };
  } catch (err) {
    logger.error({ err: err.message, invoiceId }, `invoice ${label} notice failed`);
    return { sent: false, reason: 'error' };
  }
}

function toOrganizer(label, info, invoiceId) {
  if (info.organizerEmail) return info.organizerEmail;
  logger.warn({ invoiceId }, `invoice ${label}: the organizer has no email to tell`);
  return null;
}

const money = (cents, currency) => T.money(cents, currency);
const when = (iso, event) => T.whenText(iso, event?.timezone || null);

/** An admin raised it. */
function notifyIssued(invoiceId) {
  return deliver('issued', invoiceId, async ({ invoice, info, url }) => {
    const to = toOrganizer('issued', info, invoiceId);
    if (!to) return { sent: false, reason: 'no_recipient' };
    return email.sendInvoiceIssued({
      to, organizerName: info.organizerName, invoice, event: info.event, url,
      instructions: await paymentInstructions(),
    });
  });
}

/** Due soon. `gateAffected`: whether missing it would actually switch scanning off. */
function notifyReminder(invoiceId) {
  return deliver('reminder', invoiceId, async ({ invoice, info, url }) => {
    const to = toOrganizer('reminder', info, invoiceId);
    if (!to) return { sent: false, reason: 'no_recipient' };
    const gate = await gateOf(invoice.event_id);
    const gateAffected = !gate || (gate.enforcement !== false && gate.mode !== 'open');
    return email.sendInvoiceReminder({
      to, organizerName: info.organizerName, invoice, event: info.event, url,
      instructions: await paymentInstructions(), gateAffected,
    });
  });
}

/** It fell due. Called once per invoice by the scheduler; says what the door is doing. */
function notifyOverdue(invoiceId) {
  return deliver('overdue', invoiceId, async ({ invoice, info, url }) => {
    const to = toOrganizer('overdue', info, invoiceId);
    if (!to) return { sent: false, reason: 'no_recipient' };
    return email.sendInvoiceOverdue({
      to, organizerName: info.organizerName, invoice, event: info.event, url,
      instructions: await paymentInstructions(),
      receiptSent: invoice.status === 'submitted',
      gate: (await gateOf(invoice.event_id)) || { locked: true },
    });
  });
}

/** Paid in full. `gateOpen`: the gate after settling. */
function notifySettled(invoiceId, { gateOpen = true } = {}) {
  return deliver('settled', invoiceId, async ({ invoice, info, url }) => {
    const to = toOrganizer('settled', info, invoiceId);
    if (!to) return { sent: false, reason: 'no_recipient' };
    const wasOverdue = Boolean(invoice.due_at && invoice.confirmed_at
      && new Date(invoice.due_at) < new Date(invoice.confirmed_at));
    return email.sendInvoiceSettled({
      to, organizerName: info.organizerName, invoice, event: info.event, url, gateOpen, wasOverdue,
    });
  });
}

/**
 * The other changes the organizer must hear about. `kind` picks the words;
 * `reason` is the admin's own, shown as written.
 */
function notifyUpdate(invoiceId, kind, { reason = null, amountCents = null, previousDueAt = null } = {}) {
  return deliver(kind, invoiceId, async ({ invoice, info, url }) => {
    const to = toOrganizer(kind, info, invoiceId);
    if (!to) return { sent: false, reason: 'no_recipient' };
    const event = info.event;
    const base = { to, organizerName: info.organizerName, invoice, event, url, reason };
    const left = money(invoice.balance_cents, invoice.currency);

    const words = {
      receipt_rejected: {
        subject: `Receipt not accepted — ${invoice.number}`,
        title: 'We could not accept your receipt',
        lead: `We checked the receipt you sent for invoice <strong>${T.escapeHtml(invoice.number)}</strong> and could not match it to a payment. The invoice is unpaid again.`,
        tone: 'warning', reasonLabel: 'What we found',
        facts: [['To pay', left], ['Due', when(invoice.due_at, event)]],
        instructions: await paymentInstructions(), buttonLabel: 'Send another receipt',
      },
      payment_recorded: {
        subject: `Payment received — ${invoice.number}`,
        title: 'Payment received',
        lead: `We received <strong>${T.escapeHtml(money(amountCents, invoice.currency))}</strong> toward invoice <strong>${T.escapeHtml(invoice.number)}</strong>. Thank you.`,
        tone: 'info', reason: null,
        facts: [['Received', money(amountCents, invoice.currency)], ['Still to pay', left], ['Due', when(invoice.due_at, event)]],
        instructions: null,
      },
      payment_reversed: {
        subject: `Payment no longer counted — ${invoice.number}`,
        title: 'A payment was reversed',
        lead: `A payment of <strong>${T.escapeHtml(money(amountCents, invoice.currency))}</strong> recorded on invoice <strong>${T.escapeHtml(invoice.number)}</strong> no longer counts.`,
        tone: 'warning',
        facts: [['To pay', left], ['Due', when(invoice.due_at, event)]],
        instructions: await paymentInstructions(),
      },
      due_changed: {
        subject: `New due date — ${invoice.number}`,
        title: 'Your invoice has a new due date',
        lead: `Invoice <strong>${T.escapeHtml(invoice.number)}</strong> is now due <strong>${T.escapeHtml(when(invoice.due_at, event))}</strong>.`,
        tone: 'info',
        facts: [['Was due', previousDueAt ? when(previousDueAt, event) : null], ['Now due', when(invoice.due_at, event)], ['To pay', left]],
        instructions: null,
      },
      waived: {
        subject: `Invoice waived — ${invoice.number}`,
        title: 'Nothing more to pay',
        lead: `Eventsli has waived ${Number(invoice.paid_cents) > 0 ? 'the rest of' : ''} invoice <strong>${T.escapeHtml(invoice.number)}</strong>. There is nothing more to pay on it.`,
        tone: 'info',
        facts: [['Waived', money(amountCents ?? invoice.written_off_cents, invoice.currency)], ['Status', 'Closed']],
        instructions: null, buttonLabel: 'See your invoices',
      },
      voided: {
        subject: `Invoice cancelled — ${invoice.number}`,
        title: 'This invoice was cancelled',
        lead: `Invoice <strong>${T.escapeHtml(invoice.number)}</strong> was cancelled and is no longer due. If commission on these door sales is still owed, you will receive a corrected invoice.`,
        tone: 'info',
        facts: [['Status', 'Cancelled']],
        instructions: null, buttonLabel: 'See your invoices',
      },
      reopened: {
        subject: `Invoice reopened — ${invoice.number}`,
        title: 'This invoice is due again',
        lead: `Invoice <strong>${T.escapeHtml(invoice.number)}</strong> was reopened and <strong>${T.escapeHtml(left)}</strong> is due again.`,
        tone: 'warning',
        facts: [['To pay', left], ['Due', when(invoice.due_at, event)]],
        instructions: await paymentInstructions(),
      },
    }[kind];
    if (!words) return { sent: false, reason: 'unknown_kind' };
    return email.sendInvoiceUpdate({ ...base, ...words, reason: words.reason === null ? null : reason });
  });
}

/** The organizer uploaded a receipt: every admin is told there is money to check. */
function notifyReceiptSubmitted(invoiceId) {
  return deliver('receipt', invoiceId, async ({ invoice, info }) => {
    const admins = await adminRecipients();
    if (!admins.length) return { sent: false, reason: 'no_recipient' };
    const site = T.siteUrl();
    const adminUrl = site ? `${site}/admin/invoices/${invoice.id}` : null;
    const gate = await gateOf(invoice.event_id);
    const results = await Promise.all(admins.map((to) => email.sendInvoiceReceiptToAdmins({
      to, organizerName: info.organizerName, invoice, event: info.event,
      adminUrl, proofUrl: invoice.proof_url, overdue: Boolean(gate?.locked && gate.reason === 'commission_overdue'),
    })));
    return { sent: results.some((r) => r?.sent), count: results.filter((r) => r?.sent).length };
  });
}

/**
 * An admin changed an event's gate. The organizer hears only when the door
 * actually changed state — closing a gate that was already shut by an overdue
 * invoice is news ("Eventsli closed it"), but changing a temporary exemption's
 * end time on an open gate is not worth an email.
 */
async function notifyGateChanged(eventId, { before, after, reason }) {
  try {
    const wasLocked = Boolean(before?.locked);
    const isLocked = Boolean(after?.locked);
    const closedByAdmin = isLocked && after?.reason === 'admin_closed' && before?.reason !== 'admin_closed';
    if (wasLocked === isLocked && !closedByAdmin) return { sent: false, reason: 'no_change' };
    const info = await loadForEmail(eventId);
    if (!info?.organizerEmail) return { sent: false, reason: 'no_recipient' };
    const site = T.siteUrl();
    return email.sendGateChanged({
      to: info.organizerEmail, organizerName: info.organizerName, event: info.event,
      url: site ? `${site}/organizer/events/${eventId}/devices` : null,
      opened: !isLocked, reason, until: after?.mode_until || null,
    });
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'gate change notice failed');
    return { sent: false, reason: 'error' };
  }
}

module.exports = {
  notifyIssued, notifyReminder, notifyOverdue, notifySettled, notifyUpdate,
  notifyReceiptSubmitted, notifyGateChanged, paymentInstructions, commissionUrl,
};
