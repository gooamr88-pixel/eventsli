import { Suspense } from 'react';
import MapEditor from './MapEditor';

export const metadata = {
  title: 'Event map',
  robots: { index: false, follow: false },
};

export default async function MapPage({ params }) {
  const { id } = await params;
  // Suspense: the editor reads ?venueMap= (useSearchParams).
  return <Suspense><MapEditor eventId={id} /></Suspense>;
}
