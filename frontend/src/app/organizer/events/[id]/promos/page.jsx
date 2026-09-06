import Promos from './Promos';

export const metadata = {
  title: 'Discount codes',
  robots: { index: false, follow: false },
};

export default async function PromosPage({ params }) {
  const { id } = await params;
  return <Promos eventId={id} />;
}
