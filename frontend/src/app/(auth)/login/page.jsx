import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary, or the whole route opts out of
    // static rendering and the build says so.
    <Suspense fallback={<p className="text-sm text-subtle">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
