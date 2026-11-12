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

/**
 * The four figures over the admin's invoice list, per currency — CAD and USD
 * are never added together.
 *
 *   count        invoices of any status
 *   totalCents   everything raised, waived ones excluded (nobody owes those)
 *   unpaidCents  open, receipt sent, or overdue — the money still to come
 *   settledCents paid
 *
 * Pure, over `{ currency, amount_cents, status }` rows, so it is tested
 * without a database (test/invoices.test.js).
 */
function sumInvoiceTotals(rows) {
  const out = { count: 0, byCurrency: {} };
  for (const row of rows || []) {
    out.count += 1;
    if (!row?.currency) continue;
    // A voided invoice was raised in error: it asked for nothing.
    if (row.status === 'void') continue;
    const t = out.byCurrency[row.currency]
      || (out.byCurrency[row.currency] = { totalCents: 0, unpaidCents: 0, settledCents: 0 });
    const { amount, paid, writtenOff, balance } = invoiceMoney(row);
    // Everything asked for and not forgiven; what arrived; what is still to come.
    t.totalCents += amount - writtenOff;
    t.settledCents += paid;
    if (UNPAID.has(row.status)) t.unpaidCents += balance;
  }
  return out;
}

/**
 * An invoice row's money: face amount, paid, written off, balance.
 *
 * Rows from before payments were itemised carry no `paid_cents` /
 * `written_off_cents`; for those a paid invoice was paid in full and a waived
 * one forgave whatever was left.
 */
function invoiceMoney(row) {
  const amount = Number(row?.amount_cents) || 0;
  const status = row?.status;
  const paid = row?.paid_cents === undefined || row?.paid_cents === null
    ? (status === 'paid' ? amount : 0)
    : Number(row.paid_cents) || 0;
  const writtenOff = row?.written_off_cents === undefined || row?.written_off_cents === null
    ? (status === 'waived' ? Math.max(amount - paid, 0) : 0)
    : Number(row.written_off_cents) || 0;
  const balance = status === 'void' ? 0 : Math.max(amount - paid - writtenOff, 0);
  return { amount, paid, writtenOff, balance };
}

/**
 * The PostgREST `or` for the admin invoice search: the invoice NUMBER, or one
 * of the events whose title matched (looked up first — PostgREST cannot OR a
 * column with a column of an embedded table). `q` must already have been
 * through `safeSearch`, which strips the commas and parentheses that are
 * filter syntax inside `or(...)`. Event ids are kept only if they are UUIDs,
 * so nothing but an id can reach the `in.(...)` list.
 *
 * Returns null for an empty search — no filter at all.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invoiceSearchFilter(q, eventIds = []) {
  if (!q) return null;
  const ids = (eventIds || []).filter((id) => UUID.test(String(id)));
  return [`number.ilike.%${q}%`, ...(ids.length ? [`event_id.in.(${ids.join(',')})`] : [])].join(',');
}

module.exports = { isInvoiceOverdue, sumInvoiceTotals, invoiceMoney, invoiceSearchFilter };
