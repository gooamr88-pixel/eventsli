'use client';

import { useApi } from '../../../../../../hooks/useApi';
import { Loading, ErrorNotice, Notice } from '../../../../../../components/Feedback';
import CreditNoteDocument from '../../../../../../components/invoices/CreditNoteDocument';
import { useEventContext } from '../../../EventContext';

/**
 * One credit note as a document the organizer can print or save as a PDF.
 * Read from the event's commission endpoint, which only ever returns this
 * organizer's own (verifyEventOwner).
 */
export default function OrganizerCreditNote({ eventId, creditNoteId }) {
  const event = useEventContext()?.event;
  const { data, error, reload } = useApi(`/events/${eventId}/commission`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <Loading variant="card" label="Loading the credit note" />;
  const note = (data.creditNotes || []).find((n) => n.id === creditNoteId);
  if (!note) {
    return <Notice tone="warning" title="That credit note is not part of this event."><p>Open it from the event&rsquo;s Commission page.</p></Notice>;
  }
  const invoiceNumber = (data.invoices || []).find((i) => i.id === note.invoiceId)?.number || null;
  return (
    <CreditNoteDocument
      creditNote={note}
      event={event}
      invoiceNumber={invoiceNumber}
      backHref={`/organizer/events/${eventId}/commission`}
    />
  );
}
