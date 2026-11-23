import Attendees from './Attendees';
import VendorStaff from './VendorStaff';

export const metadata = {
  title: 'Door list',
  robots: { index: false, follow: false },
};

/** Ticket holders, then — for an event with vendors — their staff (2026-11-23). */
export default async function AttendeesPage({ params }) {
  const { id } = await params;
  return (
    <div className="fx-stack">
      <Attendees eventId={id} />
      <VendorStaff eventId={id} />
    </div>
  );
}
