import Invoices from './Invoices';

export const metadata = {
  title: 'Invoices',
  robots: { index: false, follow: false },
};

export default async function InvoicesPage({ searchParams }) {
  const params = (await searchParams) || {};
  const status = typeof params.status === 'string' ? params.status : '';
  const eventId = typeof params.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(params.eventId) ? params.eventId : '';
  return <Invoices initialStatus={status} eventId={eventId} />;
}
