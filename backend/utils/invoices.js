/**
 * Whether a commission invoice is overdue (BRD §18).
 *
 * Two ways to be overdue, and the answer has to be yes to both:
 *   • the hourly job has already labelled it `overdue`;
 *   • it is still `open` or `submitted` and its due date has passed, but the
 *     job has not run yet — the gate is already shut in between.
 *
 * The check used to cover only the second, so an invoice the job HAD labelled
 * reported `isOverdue: false` — on the very invoices that shut gates.
 *
 * Pure, so it is unit-tested without a database.
 */
const UNPAID = new Set(['open', 'submitted', 'overdue']);

function isInvoiceOverdue(invoice, now = new Date()) {
  if (!invoice) return false;
  const status = invoice.status;
  if (status === 'overdue') return true;
  if (!UNPAID.has(status)) return false;
  const due = invoice.due_at ?? invoice.dueAt;
  return Boolean(due) && new Date(due) < now;
}

module.exports = { isInvoiceOverdue };
