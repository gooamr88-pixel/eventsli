import { Suspense } from 'react';
import LoginForm from './LoginForm';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary, or the whole route opts out of
    // static rendering and the build says so.
    <Suspense fallback={<Loading variant="card" />}>
      <LoginForm />
    </Suspense>
  );
}
