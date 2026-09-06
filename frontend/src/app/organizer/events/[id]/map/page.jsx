import MapEditor from './MapEditor';

export const metadata = {
  title: 'Seat map',
  robots: { index: false, follow: false },
};

export default async function MapPage({ params }) {
  const { id } = await params;
  return <MapEditor eventId={id} />;
}
