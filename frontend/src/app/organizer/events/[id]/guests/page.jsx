import HostGuests from './HostGuests';

export const metadata = {
  title: 'Hosts & guests',
  robots: { index: false, follow: false },
};

export default async function HostGuestsPage({ params }) {
  const { id } = await params;
  return <HostGuests eventId={id} />;
}
