import { Suspense } from 'react';
import LibraryMapEditor from './LibraryMapEditor';

export const metadata = {
  title: 'Edit venue map',
  robots: { index: false, follow: false },
};

/**
 * An Eventsli library map, in the Venue Builder (owner, 2026-11-24: "add
 * ability to edit the map"). The editor is the organizers' own, in library
 * mode: it loads this map and saves it back into the library.
 */
export default async function LibraryMapPage({ params }) {
  const { id } = await params;
  // Suspense: the editor reads the query string (useSearchParams).
  return <Suspense><LibraryMapEditor templateId={id} /></Suspense>;
}
