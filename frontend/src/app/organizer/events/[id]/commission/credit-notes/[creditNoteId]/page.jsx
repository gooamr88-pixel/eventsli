import OrganizerCreditNote from './OrganizerCreditNote';

export const metadata = {
  title: 'Credit note',
  robots: { index: false, follow: false },
};

export default async function OrganizerCreditNotePage({ params }) {
  const { id, creditNoteId } = await params;
  return <OrganizerCreditNote eventId={id} creditNoteId={creditNoteId} />;
}
