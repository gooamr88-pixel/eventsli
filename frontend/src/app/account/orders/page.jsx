import Orders from './Orders';

export const metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export default function OrdersPage() {
  return <Orders />;
}
