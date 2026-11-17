import AdminCreditNote from './AdminCreditNote';

export const metadata = {
  title: 'Credit note',
  robots: { index: false, follow: false },
};

export default async function AdminCreditNotePage({ params }) {
  const { id } = await params;
  return <AdminCreditNote creditNoteId={id} />;
}
