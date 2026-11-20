import MyVendorBookings from './MyVendorBookings';

export const metadata = {
  title: 'Vendor bookings',
  robots: { index: false, follow: false },
};

/** Vendor applications and bookings for this account's address (2026-11-20). */
export default function VendorBookingsPage() {
  return <MyVendorBookings />;
}
