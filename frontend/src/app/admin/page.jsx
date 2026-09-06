import Approvals from './Approvals';

export const metadata = {
  title: 'Approvals',
  robots: { index: false, follow: false },
};

export default function AdminHome() {
  return <Approvals />;
}
