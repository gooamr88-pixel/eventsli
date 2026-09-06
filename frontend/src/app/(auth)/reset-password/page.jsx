import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata = {
  title: 'Choose a new password',
  // Never indexed: the URL carries a single-use reset token.
  robots: { index: false, follow: false, nocache: true },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-subtle">Loading…</p>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
