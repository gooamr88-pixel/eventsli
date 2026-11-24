import AdminEventEdit from './AdminEventEdit';

export const metadata = {
  title: 'Edit event',
  robots: { index: false, follow: false },
};

export default async function AdminEventEditPage({ params }) {
  const { id } = await params;
  return <AdminEventEdit eventId={id} />;
}
