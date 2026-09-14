import { Suspense } from 'react';
import EventsBrowser from './EventsBrowser';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Your events',
  robots: { index: false, follow: false },
};

// The filter lives in the URL (?status=), which a client component reads with
// useSearchParams — and that has to sit under a Suspense boundary.
export default function EventsPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={4} label="Loading your events" />}>
      <EventsBrowser />
    </Suspense>
  );
}
