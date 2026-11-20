import VendorBooking from './VendorBooking';

export const metadata = {
  title: 'Vendor booking',
  robots: { index: false, follow: false },
};

/** One vendor application, from the vendor's side (2026-11-20). */
export default async function VendorBookingPage({ params }) {
  const { appId } = await params;
  return <VendorBooking appId={appId} />;
}
