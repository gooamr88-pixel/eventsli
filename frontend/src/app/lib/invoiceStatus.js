/**
 * One label for a commission invoice's state, used by the organizer's
 * Commission page, the console's Invoices page and the admin event detail.
 *
 * There were three copies with three vocabularies ("Proof in" / "In review",
 * "Settled" / "Paid"), and none handled the `overdue` status the hourly job
 * sets — so the invoices that shut gates rendered as a raw grey word.
 */
const LABELS = {
  open: ['Unpaid', 'warning'],
  submitted: ['Receipt sent', 'neutral'],
  overdue: ['Overdue', 'danger'],
  paid: ['Settled', 'accent'],
  waived: ['Waived', 'neutral'],
};

export const TONE_CLASS = Object.freeze({
  accent: 'es-pill--accent',
  warning: 'es-pill--warning',
  danger: 'es-pill--danger',
  neutral: '',
});

export function invoiceStatus(invoice) {
  if (!invoice) return { label: '—', tone: 'neutral' };
  const settled = invoice.status === 'paid' || invoice.status === 'waived';
  if (!settled && (invoice.isOverdue || invoice.status === 'overdue')) {
    // Overdue AND a receipt is waiting — both matter to whoever is looking.
    return {
      label: invoice.status === 'submitted' ? 'Overdue · receipt sent' : 'Overdue',
      tone: 'danger',
    };
  }
  const [label, tone] = LABELS[invoice.status] || [String(invoice.status || '—'), 'neutral'];
  return { label, tone };
}
