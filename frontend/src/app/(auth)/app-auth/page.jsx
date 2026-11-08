import { Suspense } from 'react';
import AppAuthorize from './AppAuthorize';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Sign in to Eventsli Check-in',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * "Sign in with Eventsli", the website's half. The check-in app opens this in
 * the system browser; proxy.ts sends a signed-out visitor through /login first
 * and back here, so every way of signing in to the site works for the app.
 */
export default function AppAuthPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <AppAuthorize />
    </Suspense>
  );
}
