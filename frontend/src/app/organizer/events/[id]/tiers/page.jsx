import Tiers from './Tiers';

export const metadata = {
  title: 'Ticket types',
  robots: { index: false, follow: false },
};

export default async function TiersPage({ params }) {
  const { id } = await params;
  return <Tiers eventId={id} />;
}
