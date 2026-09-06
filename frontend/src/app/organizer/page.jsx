import EventList from './EventList';

export const metadata = {
  title: 'Your events',
  robots: { index: false, follow: false },
};

export default function OrganizerHome() {
  return <EventList />;
}
