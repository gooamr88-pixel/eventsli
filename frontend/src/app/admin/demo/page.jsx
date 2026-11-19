import { Suspense } from 'react';
import AdminDemo from './AdminDemo';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Demo bookings',
  robots: { index: false, follow: false },
};

export default function AdminDemoPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={4} label="Loading demo bookings" />}>
      <AdminDemo />
    </Suspense>
  );
}
