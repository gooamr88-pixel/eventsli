import InvoiceDetail from './InvoiceDetail';

export const metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false },
};

export default async function InvoicePage({ params }) {
  const { id } = await params;
  return <InvoiceDetail invoiceId={id} />;
}
