/**
 * One label for a commission invoice's state, used by the organizer's
 * Commission page, the console's Invoices pages and the admin event detail.
 *
 * Reads the money as well as the status: an unpaid invoice with payments on it
 * is "Part paid", and one whose receipt was turned down says so — both are
 * states the status column alone cannot show.
 */
const LABELS = {
  open: ['Unpaid', 'warning'],
  submitted: ['Receipt sent', 'neutral'],
  overdue: ['Overdue', 'danger'],
  paid: ['Settled', 'accent'],
  waived: ['Waived', 'neutral'],
  void: ['Void', 'neutral'],
};

export const TONE_CLASS = Object.freeze({
  accent: 'es-pill--accent',
  warning: 'es-pill--warning',
  danger: 'es-pill--danger',
  neutral: '',
});

export const SETTLED_STATUSES = Object.freeze(['paid', 'waived', 'void']);
export const UNPAID_STATUSES = Object.freeze(['open', 'submitted', 'overdue']);

export function invoiceStatus(invoice) {
  if (!invoice) return { label: '—', tone: 'neutral' };
  const unpaid = UNPAID_STATUSES.includes(invoice.status);
  const partPaid = unpaid && Number(invoice.paidCents) > 0;
  if (unpaid && (invoice.isOverdue || invoice.status === 'overdue')) {
    // Overdue AND a receipt is waiting — both matter to whoever is looking.
    return {
      label: invoice.status === 'submitted' ? 'Overdue · receipt sent' : partPaid ? 'Overdue · part paid' : 'Overdue',
      tone: 'danger',
    };
  }
  if (invoice.status === 'open' && invoice.receiptRejectedAt) return { label: 'Receipt not accepted', tone: 'warning' };
  if (partPaid && invoice.status === 'open') return { label: 'Part paid', tone: 'warning' };
  if (invoice.status === 'waived' && Number(invoice.paidCents) > 0) return { label: 'Part paid · rest waived', tone: 'neutral' };
  const [label, tone] = LABELS[invoice.status] || [String(invoice.status || '—'), 'neutral'];
  return { label, tone };
}
