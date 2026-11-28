import VipRequest from './VipRequest';

export const metadata = {
  title: 'VIP request',
  robots: { index: false, follow: false },
};

export default async function VipRequestPage({ params }) {
  const { id } = await params;
  return <VipRequest id={id} />;
}
