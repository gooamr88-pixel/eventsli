import Orders from './Orders';

export const metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export default async function OrdersPage({ params }) {
  const { id } = await params;
  return <Orders eventId={id} />;
}
