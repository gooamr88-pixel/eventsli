import { invoiceStatus, TONE_CLASS } from '../../lib/invoiceStatus';

/** A commission invoice's state as a pill — see lib/invoiceStatus.js. */
export default function InvoiceStatus({ invoice }) {
  const { label, tone } = invoiceStatus(invoice);
  return <span className={`es-pill ${TONE_CLASS[tone]} self-start whitespace-nowrap`}>{label}</span>;
}
