import { Suspense } from 'react';
import SuccessClient from './SuccessClient';

export const metadata = {
  title: 'Order confirmed',
  // Never indexed. The URL carries a Stripe session id.
  robots: { index: false, follow: false },
};

export default function SuccessPage() {
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm">
        {/* useSearchParams needs a Suspense boundary, or the whole route opts
            out of static rendering and Next says so at build time. */}
        <Suspense fallback={<p className="text-sm text-subtle">Confirming your order…</p>}>
          <SuccessClient />
        </Suspense>
      </div>
    </main>
  );
}
