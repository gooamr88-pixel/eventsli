import { Suspense } from 'react';
import OrganizerSignupForm from './OrganizerSignupForm';
import { Loading } from '../../../components/Feedback';

export const metadata = {
  title: 'Sell tickets on Eventsli',
  description: 'Create an organizer account: seat maps, ticket types, card and manual payments.',
  robots: { index: false, follow: true },
};

export default function OrganizerSignupPage() {
  return (
    // The form reads `?next=` with `useSearchParams` now, so it needs a
    // boundary like every other such component in the app. Without one this
    // route's static rendering is opted out silently — masked today by the root
    // layout's `force-dynamic`, which is a coincidence to rely on.
    <Suspense fallback={<Loading variant="card" />}>
      <OrganizerSignupForm />
    </Suspense>
  );
}
