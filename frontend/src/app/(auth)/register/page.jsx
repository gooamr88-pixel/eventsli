import { Suspense } from 'react';
import RegisterForm from './RegisterForm';

export const metadata = {
  title: 'Create an account',
  description: 'Keep your tickets in one place, and sell your own events.',
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<p className="text-sm text-subtle">Loading…</p>}>
      <RegisterForm />
    </Suspense>
  );
}
