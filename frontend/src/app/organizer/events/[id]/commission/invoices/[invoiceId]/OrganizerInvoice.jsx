'use client';

import { useApi } from '../../../../../../hooks/useApi';
import { Loading, ErrorNotice, Notice } from '../../../../../../components/Feedback';
import InvoiceDocument from '../../../../../../components/invoices/InvoiceDocument';
import { useEventContext } from '../../../EventContext';

/**
 * One commission invoice as a document the organizer can print or save as a
 * PDF. Read from the event's commission endpoint, which only ever returns this
 * organizer's own invoices (verifyEventOwner).
 */
export default function OrganizerInvoice({ eventId, invoiceId }) {
  const event = useEventContext()?.event;
  const { data, error, reload } = useApi(`/events/${eventId}/commission`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <Loading variant="card" label="Loading the invoice" />;
  const invoice = (data.invoices || []).find((i) => i.id === invoiceId);
  if (!invoice) {
    return <Notice tone="warning" title="That invoice is not part of this event."><p>Open it from the event&rsquo;s Commission page.</p></Notice>;
  }
  return (
    <InvoiceDocument
      invoice={invoice}
      event={event}
      instructions={data.paymentInstructions}
      backHref={`/organizer/events/${eventId}/commission`}
    />
  );
}
