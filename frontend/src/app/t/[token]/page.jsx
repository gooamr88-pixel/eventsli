import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch, PUBLIC_API_URL } from '../../utils/apiClient';
import TicketStub from '../../components/TicketStub';

/**
 * The emailed ticket link.
 *
 * The signed token in the URL IS the credential — it went to the address that
 * bought the tickets and nowhere else. That is what makes this page work on a
 * phone at the door with no account, no app and no session, which is the only
 * situation that actually matters for a ticket.
 *
 * Server-rendered so it opens on a bad connection outside a venue, and never
 * cached or indexed: it is a credential in a URL.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your ticket',
  robots: { index: false, follow: false, nocache: true },
};

export default async function TicketPage({ params }) {
  const { token } = await params;

  let ticket;
  try {
    ticket = await serverFetch(`/public/t/${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch (err) {
    // A bad signature, an expired token and a ticket that never existed all
    // arrive the same way, and this page keeps them that way.
    if (err?.status === 404 || err?.status === 401) notFound();
    throw err;
  }

  const event = ticket.event || {};
  const when = event.startsAt
    ? new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone || 'UTC',
    }).format(new Date(event.startsAt))
    : null;

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm fx-stack">
        <div className="fx-stack fx-stack--sm">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">Your ticket</p>
          <h1 className="text-xl">{event.title || 'Ticket'}</h1>
          {when && (
            <p className="text-muted">
              {when} {event.timezone && <span className="text-subtle">({event.timezone})</span>}
            </p>
          )}
          {event.venueName && <p className="text-muted">{event.venueName}</p>}
        </div>

        {/* `prominent`: this page IS the ticket. The 132px list size was
            carried over from My Tickets, where a stub sits beside three others;
            here there is nothing else on screen and the code is what the door
            is trying to read. */}
        <TicketStub
          ticket={ticket}
          qrSrc={`${PUBLIC_API_URL}/public/qr/${encodeURIComponent(ticket.qr)}`}
          prominent
        />

        <p className="text-center text-sm text-subtle">
          Show this code at the door. Screen brightness up — it is read by a camera.
        </p>

        {event.slug && (
          <Link href={`/e/${event.slug}`} className="text-sm text-accent">
            About this event →
          </Link>
        )}
      </div>
    </main>
  );
}
