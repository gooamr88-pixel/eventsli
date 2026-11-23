import { Suspense } from 'react';
import AdminVenueMaps from './AdminVenueMaps';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Venue maps',
  robots: { index: false, follow: false },
};

export default function AdminVenueMapsPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={3} label="Loading venue maps" />}>
      <AdminVenueMaps />
    </Suspense>
  );
}
