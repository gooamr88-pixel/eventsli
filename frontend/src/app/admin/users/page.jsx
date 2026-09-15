import { Suspense } from 'react';
import Users from './Users';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'People',
  robots: { index: false, follow: false },
};

// Suspense, because the filters are read from the URL (useSearchParams).
export default function UsersPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={5} label="Loading accounts" />}>
      <Users />
    </Suspense>
  );
}
