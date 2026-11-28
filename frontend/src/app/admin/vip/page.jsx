import { Suspense } from 'react';
import AdminVip from './AdminVip';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'VIP Services',
  robots: { index: false, follow: false },
};

export default function AdminVipPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={4} label="Loading VIP Services" />}>
      <AdminVip />
    </Suspense>
  );
}
