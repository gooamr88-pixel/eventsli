import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
