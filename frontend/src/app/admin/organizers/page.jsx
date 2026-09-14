import { Suspense } from 'react';
import AdminOrganizers from './AdminOrganizers';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Organizers',
  robots: { index: false, follow: false },
};

export default function AdminOrganizersPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={5} label="Loading organizers" />}>
      <AdminOrganizers />
    </Suspense>
  );
}
