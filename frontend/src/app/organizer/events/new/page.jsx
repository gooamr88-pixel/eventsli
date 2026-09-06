import NewEventForm from './NewEventForm';

export const metadata = {
  title: 'New event',
  robots: { index: false, follow: false },
};

export default function NewEventPage() {
  return <NewEventForm />;
}
