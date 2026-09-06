import { Suspense } from 'react';
import Payouts from './Payouts';

export const metadata = {
  title: 'Payouts',
  robots: { index: false, follow: false },
};

export default function PayoutsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-subtle">Loading…</p>}>
      <Payouts />
    </Suspense>
  );
}
