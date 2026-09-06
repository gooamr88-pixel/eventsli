import { Suspense } from 'react';
import Payouts from './Payouts';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Payouts',
  robots: { index: false, follow: false },
};

export default function PayoutsPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <Payouts />
    </Suspense>
  );
}
