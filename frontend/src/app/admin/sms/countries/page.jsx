import Countries from './Countries';

export const metadata = {
  title: 'SMS countries',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Countries />;
}
