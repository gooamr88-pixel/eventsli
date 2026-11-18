import { Suspense } from 'react';
import Templates from './Templates';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Templates',
  robots: { index: false, follow: false },
};

export default function TemplatesPage() {
  return (
    <Suspense fallback={<Loading variant="list" rows={3} label="Loading templates" />}>
      <Templates />
    </Suspense>
  );
}
