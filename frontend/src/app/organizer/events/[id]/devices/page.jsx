import Devices from './Devices';

export const metadata = {
  title: 'Scanning',
  robots: { index: false, follow: false },
};

export default async function DevicesPage({ params }) {
  const { id } = await params;
  return <Devices eventId={id} />;
}
