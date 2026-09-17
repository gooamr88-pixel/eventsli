import { Suspense } from 'react';
import ActivateAccount from './ActivateAccount';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Activate your account',
  robots: { index: false, follow: false, nocache: true },
};

export default function ActivatePage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <ActivateAccount />
    </Suspense>
  );
}
