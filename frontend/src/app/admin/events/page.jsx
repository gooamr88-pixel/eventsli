import { Suspense } from 'react';
import AdminEvents from './AdminEvents';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'All events',
  robots: { index: false, follow: false },
};

export default function AdminEventsPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={5} label="Loading events" />}>
      <AdminEvents />
    </Suspense>
  );
}
