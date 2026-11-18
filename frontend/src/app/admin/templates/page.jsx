import { Suspense } from 'react';
import AdminTemplates from './AdminTemplates';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Event templates',
  robots: { index: false, follow: false },
};

export default function AdminTemplatesPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={3} label="Loading templates" />}>
      <AdminTemplates />
    </Suspense>
  );
}
