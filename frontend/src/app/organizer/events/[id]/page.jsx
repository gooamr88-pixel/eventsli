import EventOverview from './EventOverview';

export const metadata = {
  title: 'Event',
  robots: { index: false, follow: false },
};

// The event comes from EventContext, fetched once by the layout — the id prop
// this used to pass was never read.
export default function EventPage() {
  return <EventOverview />;
}
