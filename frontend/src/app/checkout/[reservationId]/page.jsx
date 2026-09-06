import CheckoutClient from './CheckoutClient';

/**
 * Checkout.
 *
 * Entirely client-rendered, and that is the right call here even though the
 * event page next door is the opposite. Everything on this page is per-buyer
 * and time-bounded: a quote that expires, a hold with a countdown, a promo code
 * being applied. There is nothing to cache, nothing to index, and a server
 * render would be stale before it reached the browser.
 */
export const metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ params }) {
  const { reservationId } = await params;
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm">
        <CheckoutClient reservationId={reservationId} />
      </div>
    </main>
  );
}
