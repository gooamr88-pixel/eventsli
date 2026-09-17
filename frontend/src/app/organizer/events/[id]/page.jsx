import { Suspense } from 'react';
import EventOverview from './EventOverview';
import { Loading } from '../../../components/Feedback';

export const metadata = {
  title: 'Event',
  robots: { index: false, follow: false },
};

// The event comes from EventContext, fetched once by the layout — the id prop
// this used to pass was never read. Suspense because the overview reads
// `?created=1` to greet a brand-new event.
export default function EventPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <EventOverview />
    </Suspense>
  );
}
