import EventOverview from './EventOverview';

export const metadata = {
  title: 'Event',
  robots: { index: false, follow: false },
};

export default async function EventPage({ params }) {
  const { id } = await params;
  return <EventOverview eventId={id} />;
}
