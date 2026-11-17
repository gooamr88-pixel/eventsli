import OfflinePayments from './OfflinePayments';

export const metadata = {
  title: 'Offline payments',
  robots: { index: false, follow: false },
};

export default async function OfflinePaymentsPage({ params }) {
  const { id } = await params;
  return <OfflinePayments eventId={id} />;
}
