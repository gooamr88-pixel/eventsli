import { Suspense } from 'react';
import OfflinePaymentClient from './OfflinePaymentClient';

export const metadata = {
  title: 'Pay the organizer',
  // Never indexed: the URL carries the access token for this reservation.
  robots: { index: false, follow: false },
};

export default async function OfflinePaymentPage({ params }) {
  const { id } = await params;
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--md">
        <Suspense fallback={<p className="text-sm text-subtle">Loading your reservation…</p>}>
          <OfflinePaymentClient id={id} />
        </Suspense>
      </div>
    </main>
  );
}
