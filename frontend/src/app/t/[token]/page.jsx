import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch, PUBLIC_API_URL } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import TicketStub from '../../components/TicketStub';
import SaveTicket, { TicketPrintStyles } from './SaveTicket';

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
  /**
   * `formatEventTime`, not a private copy — it names the zone as "EST" rather
   * than printing the IANA identifier in brackets, which is what this page did
   * while My Tickets did something third. It also stops the silent fall back to
   * UTC this had: a missing zone showed a confidently wrong time rather than
   * the reader's own, labelled.
   */
  const when = event.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;

  return (
    <main className="es-ticket-page fx-section fx-section--sm">
      <TicketPrintStyles />
      <div className="fx-container fx-container--sm fx-stack">
        <div className="fx-stack fx-stack--sm">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">Your ticket</p>
          <h1 className="text-xl">{event.title || 'Ticket'}</h1>
          {when && <p className="text-muted">{when}</p>}
          {event.venueName && <p className="text-muted">{event.venueName}</p>}
        </div>

        {/* `prominent`: this page IS the ticket. The 132px list size was
            carried over from My Tickets, where a stub sits beside three others;
            here there is nothing else on screen and the code is what the door
            is trying to read. */}
        <TicketStub
          ticket={ticket}
          timeZone={event.timezone}
          qrSrc={`${PUBLIC_API_URL}/public/qr/${encodeURIComponent(ticket.qr)}`}
          prominent
        />

        <p className="text-center text-sm text-subtle">
          Show this code at the door. Screen brightness up — it is read by a camera.
        </p>

        {/* The way to keep it. This page is the only copy a guest buyer has,
            and until now it offered no way to save one. */}
        <SaveTicket />

        {event.slug && (
          <Link href={`/e/${event.slug}`} className="es-ticket-print-hide text-sm text-accent">
            About this event →
          </Link>
        )}
      </div>
    </main>
  );
}
