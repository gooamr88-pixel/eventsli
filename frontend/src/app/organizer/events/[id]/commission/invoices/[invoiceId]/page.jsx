import OrganizerInvoice from './OrganizerInvoice';

export const metadata = {
  title: 'Commission invoice',
  robots: { index: false, follow: false },
};

export default async function OrganizerInvoicePage({ params }) {
  const { id, invoiceId } = await params;
  return <OrganizerInvoice eventId={id} invoiceId={invoiceId} />;
}
