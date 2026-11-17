import AdminInvoiceDocument from './AdminInvoiceDocument';

export const metadata = {
  title: 'Invoice document',
  robots: { index: false, follow: false },
};

export default async function AdminInvoiceDocumentPage({ params }) {
  const { id } = await params;
  return <AdminInvoiceDocument invoiceId={id} />;
}
