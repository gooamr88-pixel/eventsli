import DoorSales from './DoorSales';

export const metadata = {
  title: 'Door sales',
  robots: { index: false, follow: false },
};

export default async function DoorPage({ params }) {
  const { id } = await params;
  return <DoorSales eventId={id} />;
}
