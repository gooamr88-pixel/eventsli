import Vendors from './Vendors';

export const metadata = {
  title: 'Vendors',
  robots: { index: false, follow: false },
};

/** The event's vendor desk (2026-11-20). */
export default async function VendorsPage({ params }) {
  const { id } = await params;
  return <Vendors eventId={id} />;
}
