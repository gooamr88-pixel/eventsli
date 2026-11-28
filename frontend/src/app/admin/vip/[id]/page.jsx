import AdminVipRequest from './AdminVipRequest';

export const metadata = {
  title: 'VIP request',
  robots: { index: false, follow: false },
};

export default async function AdminVipRequestPage({ params }) {
  const { id } = await params;
  return <AdminVipRequest id={id} />;
}
