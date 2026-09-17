import { Suspense } from 'react';
import PaymentMethods from './PaymentMethods';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Payment methods',
  robots: { index: false, follow: false },
};

export default function PaymentMethodsPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <PaymentMethods />
    </Suspense>
  );
}
