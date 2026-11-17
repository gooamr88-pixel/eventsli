import Tiers from './Tiers';
import AddonsPanel from './AddonsPanel';

export const metadata = {
  title: 'Ticket types',
  robots: { index: false, follow: false },
};

/** Ticket types, then the add-ons sold with them (2026-11-17). */
export default async function TiersPage({ params }) {
  const { id } = await params;
  return (
    <div className="fx-stack">
      <Tiers eventId={id} />
      <AddonsPanel eventId={id} />
    </div>
  );
}
