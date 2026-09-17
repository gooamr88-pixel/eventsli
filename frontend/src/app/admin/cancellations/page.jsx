import Cancellations from './Cancellations';

export const metadata = {
  title: 'Cancellation requests',
  robots: { index: false, follow: false },
};

export default function CancellationsPage() {
  return <Cancellations />;
}
