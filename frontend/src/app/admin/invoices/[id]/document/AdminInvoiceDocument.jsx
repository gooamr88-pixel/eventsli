'use client';

import { useApi } from '../../../../hooks/useApi';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import InvoiceDocument from '../../../../components/invoices/InvoiceDocument';

/** The same document the organizer sees, for an admin to print or send. */
export default function AdminInvoiceDocument({ invoiceId }) {
  const detail = useApi(`/admin/invoices/${invoiceId}`);
  const settings = useApi('/admin/settings');

  if (detail.error) return <ErrorNotice error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading variant="card" label="Loading the invoice" />;
  const manual = Array.isArray(settings.data) ? settings.data.find((s) => s.key === 'manual_invoice') : null;
  const instructions = manual?.value?.payment_instructions || null;

  return (
    <InvoiceDocument
      invoice={detail.data.invoice}
      event={detail.data.event}
      instructions={instructions}
      backHref={`/admin/invoices/${invoiceId}`}
    />
  );
}
