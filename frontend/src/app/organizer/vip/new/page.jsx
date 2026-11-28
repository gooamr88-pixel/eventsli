import VipRequestForm from './VipRequestForm';

export const metadata = {
  title: 'Start a VIP request',
  robots: { index: false, follow: false },
};

export default function NewVipRequestPage() {
  return <VipRequestForm />;
}
