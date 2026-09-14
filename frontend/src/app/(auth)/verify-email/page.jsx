import { Suspense } from 'react';
import VerifyEmailForm from './VerifyEmailForm';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false, nocache: true },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
