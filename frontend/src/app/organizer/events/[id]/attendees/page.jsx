import Attendees from './Attendees';

export const metadata = {
  title: 'Door list',
  robots: { index: false, follow: false },
};

export default async function AttendeesPage({ params }) {
  const { id } = await params;
  return <Attendees eventId={id} />;
}
