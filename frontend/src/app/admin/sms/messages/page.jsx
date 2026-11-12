import { Suspense } from 'react';
import Messages from './Messages';
import { Loading } from '../../../components/Feedback';

export const metadata = {
  title: 'SMS delivery log',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<Loading variant="list" rows={4} />}>
      <Messages />
    </Suspense>
  );
}
