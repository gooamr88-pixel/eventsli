import { Suspense } from 'react';
import Campaigns from './Campaigns';
import { Loading } from '../../../components/Feedback';

export const metadata = {
  title: 'SMS campaigns',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<Loading variant="list" rows={4} />}>
      <Campaigns />
    </Suspense>
  );
}
