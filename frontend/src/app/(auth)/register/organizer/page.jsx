import OrganizerSignupForm from './OrganizerSignupForm';

export const metadata = {
  title: 'Sell tickets on Eventsli',
  description: 'Create an organizer account: seat maps, ticket types, card and manual payments.',
  robots: { index: false, follow: true },
};

export default function OrganizerSignupPage() {
  return <OrganizerSignupForm />;
}
