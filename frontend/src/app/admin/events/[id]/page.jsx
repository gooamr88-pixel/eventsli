import AdminEventDetail from './AdminEventDetail';

export const metadata = {
  title: 'Event',
  robots: { index: false, follow: false },
};

export default async function AdminEventPage({ params }) {
  const { id } = await params;
  return <AdminEventDetail eventId={id} />;
}
