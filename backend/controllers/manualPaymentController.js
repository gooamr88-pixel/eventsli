const { supabase } = require('../config/supabase');
const manual = require('../services/manualPaymentService');
const tickets = require('../services/ticketService');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');
const { sumInvoiceTotals, invoiceSearchFilter } = require('../utils/invoices');
const { safeSearch } = require('../utils/search');
const { fetchAll } = require('../utils/fetchAll');
const notices = require('../services/invoiceNotices');
const invoices = require('../services/invoiceService');
const { inBackground } = require('../services/eventPublishing');

const statusFor = (code) => ERROR_STATUS[code] || 400;
const asFailure = (res, err) => sendFail(res, {
  status: statusFor(err.code), error: err.code, message: err.message, meta: err.meta,
});

// ═══ ORGANIZER ══════════════════════════════════════════════════════════════

// POST /events/:eventId/manual-sales/quote
/**
 * What the commission on this sale would be, before recording it.
 *
 * Shown first so the organizer sees the debt they are about to create at the
 * moment they create it — not a week later on an invoice they did not expect.
 */
async function quote(req, res, next) {
  try {
    const { breakdown, event, seatCount } = await manual.priceManualSale({
      eventId: req.params.eventId,
      seatIds: req.body.seatIds,
      tableId: req.body.tableId,
    });
    return sendOk(res, {
      currency: event.currency,
      seatCount,
      subtotalCents: breakdown.subtotalCents,
      eventTaxCents: breakdown.eventTaxCents,
      buyerPaysCents: breakdown.buyerTotalCents,
      commissionOwedCents: breakdown.commissionCents + breakdown.commissionTaxCents,
    });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// POST /events/:eventId/manual-sales
async function record(req, res, next) {
  try {
    const result = await manual.recordSale({
      eventId: req.params.eventId,
      seatIds: req.body.seatIds,
      tableId: req.body.tableId,
      buyer: {
        name: (req.body.buyerName || '').trim(),
        email: (req.body.buyerEmail || '').trim().toLowerCase() || null,
        phone: (req.body.buyerPhone || '').trim() || null,
      },
      method: req.body.method,
      note: req.body.note,
      recordedBy: req.user.id,
    });

    logger.info({ eventId: req.params.eventId, orderId: result.order_id }, 'manual sale recorded');

    return sendOk(res, {
      orderId: result.order_id,
      ticketCount: result.ticket_count,
      commissionOwedCents: result.commission_owed_cents,
      tickets: await tickets.forOrder(result.order_id),
    }, { status: 201 });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// GET /events/:eventId/manual-sales
async function listSales(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at', 'buyer_total_cents'], defaultSort: 'created_at' });
    const query = supabase
      .from('orders')
      .select('id, currency, quantity, subtotal_cents, event_tax_cents, commission_cents, commission_tax_cents, buyer_total_cents, guest_name, guest_email, manual_method, manual_note, created_at', { count: 'exact' })
      .eq('event_id', req.params.eventId)
      .eq('channel', 'manual');

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((o) => ({
      id: o.id,
      currency: o.currency,
      seats: o.quantity,
      subtotalCents: o.subtotal_cents,
      taxCents: o.event_tax_cents,
      buyerPaidCents: o.buyer_total_cents,
      commissionOwedCents: o.commission_cents + o.commission_tax_cents,
      buyer: { name: o.guest_name, email: o.guest_email },
      method: o.manual_method,
      note: o.manual_note,
      recordedAt: o.created_at,
    })), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

// GET /events/:eventId/commission
async function debt(req, res, next) {
  try {
    return sendOk(res, await manual.debtFor(req.params.eventId));
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// POST /events/:eventId/invoices/:invoiceId/proof
async function submitProof(req, res, next) {
  try {
    const result = await manual.submitProof({
      invoiceId: req.params.invoiceId,
      organizerId: req.user.access.organizerId,
      userId: req.user.id,
      proofUrl: String(req.body.proofUrl).trim(),
    });
    // An admin has to look at it, so every admin is told there is something to
    // look at. In the background — the organizer's request does not wait on mail.
    inBackground('invoice receipt notice', notices.notifyReceiptSubmitted(result.id));
    const gate = await gateFor(result.id);
    // The gate reopens on a receipt only if the platform's policy pauses
    // enforcement while one is reviewed; otherwise the proof waits for an admin.
    return sendOk(res, { ...result, gate, gateReopened: Boolean(gate && !gate.locked), awaitingReview: true });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// ═══ ADMIN ══════════════════════════════════════════════════════════════════

const LIST_COLUMNS = 'id, number, currency, amount_cents, paid_cents, written_off_cents, status, issued_at, due_at, due_at_original, proof_url, proof_submitted_at, receipt_rejected_at, confirmed_at, order_count, voided_at, waived_at';

// GET /admin/invoices
async function adminList(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['issued_at', 'due_at', 'amount_cents'], defaultSort: 'due_at' });

    let query = supabase
      .from('invoices')
      .select(`${LIST_COLUMNS}, events ( id, title, slug, starts_at, timezone ), organizers ( id, display_name )`, { count: 'exact' });

    // "Overdue" is every unpaid invoice past its due date — the ones that can
    // shut a gate — not only those the hourly job has relabelled.
    if (req.query.status === 'overdue') {
      query = query.in('status', ['open', 'submitted', 'overdue']).lt('due_at', new Date().toISOString());
    } else if (req.query.status === 'unpaid') {
      query = query.in('status', ['open', 'submitted', 'overdue']);
    } else if (req.query.status) {
      query = query.eq('status', req.query.status);
    }
    if (req.query.organizerId) query = query.eq('organizer_id', req.query.organizerId);
    if (req.query.eventId) query = query.eq('event_id', req.query.eventId);
    if (req.query.issuedSince) query = query.gte('issued_at', req.query.issuedSince);

    const q = safeSearch(req.query.q);
    if (q) {
      const { data: hits, error: hitError } = await supabase
        .from('events').select('id').ilike('title', `%${q}%`).limit(200);
      if (hitError) throw new Error(hitError.message);
      query = query.or(invoiceSearchFilter(q, (hits || []).map((e) => e.id)));
    }

    // Oldest due first by default — the invoices waiting longest are the ones
    // with a gate shut behind them.
    const [{ data, error, count }, totals] = await Promise.all([
      applyPagination(query, { ...p, order: req.query.order === 'desc' ? 'desc' : 'asc' }),
      invoiceTotals(),
    ]);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((i) => ({
      ...invoices.shapeInvoice(i),
      event: i.events && { id: i.events.id, title: i.events.title, startsAt: i.events.starts_at, timezone: i.events.timezone },
      organizer: i.organizers && { id: i.organizers.id, name: i.organizers.display_name },
    })), { pagination: buildMeta(p, count), meta: { totals } });
  } catch (err) { return next(err); }
}

/**
 * The figures over the admin's invoice list — for EVERY invoice, not the
 * filtered page. Through `fetchAll`: the Data API stops at 1,000 rows silently.
 */
async function invoiceTotals() {
  const rows = await fetchAll((range, first) => supabase
    .from('invoices')
    .select('id, currency, amount_cents, paid_cents, written_off_cents, status', first ? { count: 'exact' } : undefined)
    .order('id', { ascending: true })
    .range(range.from, range.to), { what: 'invoices' });
  return sumInvoiceTotals(rows);
}

// GET /admin/invoices/:invoiceId
async function adminDetail(req, res, next) {
  try {
    return sendOk(res, await invoices.detail(req.params.invoiceId));
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// The audit trail for invoice actions — checked, see services/auditService.js.
const { writeAudit } = require('../services/auditService');

/** The gate for the event an invoice belongs to, or null if it cannot be read. */
async function gateFor(invoiceId) {
  const eventId = await invoices.eventOf(invoiceId);
  if (!eventId) return null;
  const { data: gate, error } = await supabase.rpc('scanner_is_locked', { p_event_id: eventId });
  if (error) {
    logger.warn({ err: error.message, invoiceId }, 'invoice action: could not read the gate');
    return null;
  }
  return gate;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ADMIN INVOICE ACTION, the same way:
 *
 *   1. run it (one database function — atomic, history and ledger included)
 *   2. write the audit row, with the admin's reason and the outcome
 *   3. tell the organizer, when the change is theirs to know
 *   4. answer with the invoice as it now stands AND the event's gate, because
 *      the person clicking is usually on the phone to the organizer and needs
 *      to say whether the door is open
 * ─────────────────────────────────────────────────────────────────────────────
 */
function adminAction({ audit, run, payload = () => ({}), notify = null }) {
  return async (req, res, next) => {
    try {
      const result = await run(req);
      const invoiceId = result.invoice_id || req.params.invoiceId;
      const gate = await gateFor(invoiceId);
      const audited = await writeAudit(req, {
        action: `invoice.${audit}`, targetType: 'invoice', targetId: invoiceId,
        payload: {
          ...payload(req, result),
          status: result.status ?? null,
          balanceCents: result.balance_cents ?? null,
          gateLocked: gate ? Boolean(gate.locked) : null,
        },
      });
      const notice = notify ? await notify(req, result, gate) : null;
      logger.info({ invoiceId, action: audit, by: req.user.id }, 'invoice action');
      return sendOk(res, {
        ...result,
        gate,
        gateReopened: gate ? !gate.locked : null,
        organizerNotified: Boolean(notice?.sent),
        audited,
      });
    } catch (err) {
      if (err.code) return asFailure(res, err);
      return next(err);
    }
  };
}

const reasonOf = (req) => (req.body.reason || '').trim();

// POST /admin/events/:eventId/invoices — raising stays an admin's act.
const adminRaise = async (req, res, next) => {
  try {
    const invoice = await manual.raiseInvoice(req.params.eventId, req.user.id);
    await writeAudit(req, {
      action: 'invoice.raised', targetType: 'invoice', targetId: invoice?.invoice_id || null,
      payload: {
        eventId: req.params.eventId,
        number: invoice?.number || null,
        amountCents: invoice?.amount_cents ?? null,
        orderCount: invoice?.order_count ?? null,
      },
    });
    const notice = invoice?.invoice_id ? await notices.notifyIssued(invoice.invoice_id) : { sent: false };
    return sendOk(res, { ...invoice, organizerNotified: Boolean(notice?.sent) }, { status: 201 });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
};

/** Paid in full → "settled"; part paid → "payment received, X left". */
const afterPayment = (req, result, gate) => (result.settled
  ? notices.notifySettled(result.invoice_id, { gateOpen: gate ? !gate.locked : true })
  : notices.notifyUpdate(result.invoice_id, 'payment_recorded', { amountCents: Number(req.body.amountCents) }));

// POST /admin/invoices/:invoiceId/settle — the whole balance, as one payment.
const adminSettle = adminAction({
  audit: 'settled',
  run: (req) => manual.settle({ invoiceId: req.params.invoiceId, adminId: req.user.id, note: req.body.note }),
  payload: (req, r) => ({ note: req.body.note || null, alreadySettled: Boolean(r.already_settled) }),
  // Told once: a second settle of the same invoice is a no-op, not news.
  notify: (req, r, gate) => (r.already_settled ? null : notices.notifySettled(r.invoice_id, { gateOpen: gate ? !gate.locked : true })),
});

// POST /admin/invoices/:invoiceId/payments
const adminRecordPayment = adminAction({
  audit: 'payment_recorded',
  run: (req) => invoices.recordPayment({
    invoiceId: req.params.invoiceId,
    amountCents: Number(req.body.amountCents),
    method: req.body.method,
    reference: req.body.reference,
    receivedAt: req.body.receivedAt,
    note: req.body.note,
    adminId: req.user.id,
  }),
  payload: (req, r) => ({
    paymentId: r.payment_id, amountCents: Number(req.body.amountCents), method: req.body.method || null,
    reference: req.body.reference || null, receivedAt: req.body.receivedAt || null, note: req.body.note || null,
  }),
  notify: (req, r, gate) => (req.body.notify === false ? null : afterPayment(req, r, gate)),
});

// POST /admin/invoices/:invoiceId/payments/:paymentId/reverse
const adminReversePayment = adminAction({
  audit: 'payment_reversed',
  run: (req) => invoices.reversePayment({ paymentId: req.params.paymentId, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req) => ({ paymentId: req.params.paymentId, reason: reasonOf(req) }),
  notify: async (req, r) => {
    const { data: pay } = await supabase.from('invoice_payments').select('amount_cents').eq('id', req.params.paymentId).maybeSingle();
    return notices.notifyUpdate(r.invoice_id, 'payment_reversed', { reason: reasonOf(req), amountCents: pay?.amount_cents ?? null });
  },
});

// POST /admin/invoices/:invoiceId/waive
const adminWaive = adminAction({
  audit: 'waived',
  run: (req) => invoices.waive({ invoiceId: req.params.invoiceId, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req, r) => ({ reason: reasonOf(req), waivedCents: r.waived_cents ?? null }),
  notify: (req, r) => notices.notifyUpdate(r.invoice_id, 'waived', { reason: reasonOf(req), amountCents: r.waived_cents }),
});

// POST /admin/invoices/:invoiceId/reopen — undoes a waiver.
const adminReopen = adminAction({
  audit: 'reopened',
  run: (req) => invoices.reopen({ invoiceId: req.params.invoiceId, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req) => ({ reason: reasonOf(req) }),
  notify: (req, r) => notices.notifyUpdate(r.invoice_id, 'reopened', { reason: reasonOf(req) }),
});

// POST /admin/invoices/:invoiceId/void — raised in error; the debt returns to "ready to invoice".
const adminVoid = adminAction({
  audit: 'voided',
  run: (req) => invoices.voidInvoice({ invoiceId: req.params.invoiceId, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req) => ({ reason: reasonOf(req) }),
  notify: (req, r) => notices.notifyUpdate(r.invoice_id, 'voided', { reason: reasonOf(req) }),
});

// POST /admin/invoices/:invoiceId/due-date
const adminSetDue = adminAction({
  audit: 'due_changed',
  run: (req) => invoices.setDueDate({ invoiceId: req.params.invoiceId, dueAt: req.body.dueAt, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req, r) => ({ reason: reasonOf(req), from: r.previous_due_at || null, to: req.body.dueAt }),
  notify: (req, r) => notices.notifyUpdate(r.invoice_id, 'due_changed', { reason: reasonOf(req), previousDueAt: r.previous_due_at }),
});

// POST /admin/invoices/:invoiceId/reject-receipt
const adminRejectReceipt = adminAction({
  audit: 'receipt_rejected',
  run: (req) => invoices.rejectReceipt({ invoiceId: req.params.invoiceId, reason: reasonOf(req), adminId: req.user.id }),
  payload: (req) => ({ reason: reasonOf(req) }),
  notify: (req, r) => notices.notifyUpdate(r.invoice_id, 'receipt_rejected', { reason: reasonOf(req) }),
});

// POST /admin/invoices/:invoiceId/notes — internal; the organizer never sees these.
const adminNote = adminAction({
  audit: 'note_added',
  run: (req) => invoices.addNote({ invoiceId: req.params.invoiceId, note: (req.body.note || '').trim(), adminId: req.user.id }),
  payload: (req) => ({ note: (req.body.note || '').trim() }),
});

// POST /admin/invoices/:invoiceId/remind — an admin sends the reminder now.
const adminRemind = adminAction({
  audit: 'reminder_sent',
  run: async (req) => {
    const detail = await invoices.detail(req.params.invoiceId);
    if (!detail.actions.remind) {
      throw invoices.fail('CONFLICT', 'Only an unpaid invoice has anything to remind about.');
    }
    await invoices.logReminder({ invoiceId: req.params.invoiceId, adminId: req.user.id });
    return { ok: true, invoice_id: req.params.invoiceId, status: detail.invoice.status, balance_cents: detail.invoice.balanceCents };
  },
  notify: (req) => notices.notifyReminder(req.params.invoiceId),
});

// GET /admin/invoices/ready
/**
 * Door commission no invoice covers yet — the queue invoices are raised from.
 * `canRaise` is false while the event still has an unpaid invoice.
 */
async function adminReady(req, res, next) {
  try {
    const { data, error } = await supabase.rpc('admin_uninvoiced_commission');
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map((r) => ({
      event: { id: r.event_id, title: r.title, slug: r.slug, startsAt: r.starts_at, timezone: r.timezone },
      organizer: { id: r.organizer_id, name: r.organizer_name },
      currency: r.currency,
      owedCents: Number(r.owed_cents),
      unpaidInvoiceCents: Number(r.unpaid_invoice_cents),
      uninvoicedCents: Number(r.uninvoiced_cents),
      unpaidInvoiceId: r.unpaid_invoice_id,
      canRaise: !r.unpaid_invoice_id,
      doorSales: Number(r.door_sales),
      lastSaleAt: r.last_sale_at,
    })));
  } catch (err) { return next(err); }
}

module.exports = {
  quote, record, listSales, debt, submitProof,
  adminList, adminDetail, adminReady, adminRaise, adminSettle,
  adminRecordPayment, adminReversePayment, adminWaive, adminReopen, adminVoid,
  adminSetDue, adminRejectReceipt, adminNote, adminRemind,
};
