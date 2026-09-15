const { supabase } = require('../config/supabase');
const manual = require('../services/manualPaymentService');
const tickets = require('../services/ticketService');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');
const { isInvoiceOverdue } = require('../utils/invoices');

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
      proofUrl: String(req.body.proofUrl).trim(),
    });
    // Deliberately explicit: the gate does NOT reopen here. Reopening on the
    // claim alone would make the proof decorative.
    return sendOk(res, { ...result, gateReopened: false, awaitingReview: true });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// ═══ ADMIN ══════════════════════════════════════════════════════════════════

// GET /admin/invoices
async function adminList(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['issued_at', 'due_at', 'amount_cents'], defaultSort: 'due_at' });

    let query = supabase
      .from('invoices')
      .select('id, number, currency, amount_cents, status, issued_at, due_at, proof_url, proof_submitted_at, confirmed_at, order_count, events ( id, title, slug, starts_at ), organizers ( id, display_name )', { count: 'exact' });

    if (req.query.status) query = query.eq('status', req.query.status);
    // Oldest due first by default — a queue sorted newest-first starves the
    // invoices that have been waiting longest, which are the ones with a gate
    // shut behind them.
    const { data, error, count } = await applyPagination(
      query, { ...p, order: req.query.order === 'desc' ? 'desc' : 'asc' },
    );
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((i) => ({
      id: i.id,
      number: i.number,
      currency: i.currency,
      amountCents: i.amount_cents,
      status: i.status,
      issuedAt: i.issued_at,
      dueAt: i.due_at,
      isOverdue: isInvoiceOverdue(i),
      orderCount: i.order_count,
      proofUrl: i.proof_url,
      proofSubmittedAt: i.proof_submitted_at,
      confirmedAt: i.confirmed_at,
      event: i.events && { id: i.events.id, title: i.events.title, startsAt: i.events.starts_at },
      organizer: i.organizers && { id: i.organizers.id, name: i.organizers.display_name },
    })), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

// The audit trail for invoice actions — checked, see services/auditService.js.
const { writeAudit } = require('../services/auditService');

// POST /admin/events/:eventId/invoices
// Raising an invoice starts a clock that ends with the gate locking (BRD §18),
// and it used to leave no row in the audit trail at all.
async function adminRaise(req, res, next) {
  try {
    const invoice = await manual.raiseInvoice(req.params.eventId);
    await writeAudit(req, {
      action: 'invoice.raised', targetType: 'invoice', targetId: invoice?.invoice_id || null,
      payload: {
        eventId: req.params.eventId,
        number: invoice?.number || null,
        amountCents: invoice?.amount_cents ?? null,
        orderCount: invoice?.order_count ?? null,
      },
    });
    return sendOk(res, invoice, { status: 201 });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

// POST /admin/invoices/:invoiceId/settle
async function adminSettle(req, res, next) {
  try {
    const result = await manual.settle({
      invoiceId: req.params.invoiceId, adminId: req.user.id, note: req.body.note,
    });

    await writeAudit(req, {
      action: 'invoice.settled', targetType: 'invoice', targetId: req.params.invoiceId,
      payload: { note: req.body.note || null, alreadySettled: Boolean(result?.already_settled) },
    });

    logger.info({ invoiceId: req.params.invoiceId, by: req.user.id }, 'invoice settled');
    // The gate reopens as a consequence of the balance reaching zero, not as a
    // separate action — so there is no way to settle and forget to unlock.
    return sendOk(res, { ...result, gateReopened: result.remaining_owed_cents <= 0 });
  } catch (err) {
    if (err.code) return asFailure(res, err);
    return next(err);
  }
}

module.exports = {
  quote, record, listSales, debt, submitProof,
  adminList, adminRaise, adminSettle,
};
