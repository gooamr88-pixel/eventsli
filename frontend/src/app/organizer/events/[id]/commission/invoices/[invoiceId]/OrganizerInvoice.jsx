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
/** The event's credit notes that correct this invoice or were applied to it, with what each took off it. */
function creditNotesFor(notes, invoiceId) {
  return (notes || [])
    .filter((n) => n.invoiceId === invoiceId || n.allocations.some((a) => a.invoiceId === invoiceId))
    .map((n) => ({
      ...n,
      appliedCents: n.allocations
        .filter((a) => a.invoiceId === invoiceId && (a.kind === 'applied' || a.kind === 'released'))
        .reduce((s, a) => s + (a.kind === 'released' ? -a.amountCents : a.amountCents), 0),
    }));
}

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
      creditNotes={creditNotesFor(data.creditNotes, invoiceId)}
      creditNoteHref={(n) => `/organizer/events/${eventId}/commission/credit-notes/${n.id}`}
    />
  );
}
