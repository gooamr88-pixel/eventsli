import { Suspense } from 'react';
import NewEventForm from './NewEventForm';
import { Loading } from '../../../components/Feedback';

export const metadata = {
  title: 'New event',
  robots: { index: false, follow: false },
};

export default function NewEventPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <NewEventForm />
    </Suspense>
  );
}
