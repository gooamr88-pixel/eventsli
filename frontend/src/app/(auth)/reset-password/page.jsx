import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Choose a new password',
  // Never indexed: the URL carries a single-use reset token.
  robots: { index: false, follow: false, nocache: true },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
