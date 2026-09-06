import { Suspense } from 'react';
import RegisterForm from './RegisterForm';
import { Loading } from '../../components/Feedback';

export const metadata = {
  title: 'Create an account',
  description: 'Keep your tickets in one place, and sell your own events.',
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<Loading variant="card" />}>
      <RegisterForm />
    </Suspense>
  );
}
