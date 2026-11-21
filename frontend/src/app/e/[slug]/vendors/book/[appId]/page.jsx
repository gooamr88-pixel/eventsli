import BookingFlow from './BookingFlow';

/**
 * A vendor's booking in progress (2026-11-21): business details, documents,
 * then checkout or send. Signed-in and personal, so never indexed.
 */
export const metadata = { title: 'Your vendor booking', robots: { index: false, follow: false } };

export default async function VendorBookingPage({ params }) {
  const { slug, appId } = await params;
  return <BookingFlow appId={appId} slug={slug} />;
}
