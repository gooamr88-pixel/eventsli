import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import TicketStub from '../../components/TicketStub';
import SaveTicket, { TicketPrintStyles } from './SaveTicket';
import { qrDataUri } from './qrDataUri';

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

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * THE TOKEN IN THIS URL IS AN **ORDER** TOKEN, AND THIS PAGE READ IT AS ONE
   * TICKET.
   *
   * `access.issueOrderToken(orderId)` is what the ticket email puts in the
   * link, and `GET /public/t/:token` answers it with the ORDER:
   *
   *     { orderId, event: { title, slug, startsAt, timezone, venue: {…} },
   *       currency, totalCents, purchasedAt, tickets: [ { qr, seat, … } ] }
   *
   * This page treated that object as a single ticket. Three consequences, all
   * of them visible on the one screen a buyer holds at a door:
   *
   *   · `ticket.qr` does not exist on an order, so the QR `<img>` pointed at
   *     `/public/qr/undefined` and rendered as a BROKEN IMAGE. The ticket had
   *     no code on it at all.
   *   · `ticket.seat` does not exist either, so every ticket printed the
   *     fallback label "General admission" — including reserved seats, whose
   *     section and seat number are the thing the door is looking for.
   *   · `event.venueName` does not exist (it is `event.venue.name`), so the
   *     venue line silently vanished.
   *
   * An order can hold several tickets, so this renders ALL of them. Before,
   * even if the shape had matched, a family of four buying together would have
   * been shown one code.
   * ─────────────────────────────────────────────────────────────────────────
   */
  let order;
  try {
    order = await serverFetch(`/public/t/${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch (err) {
    // A bad signature, an expired token and an order that never existed all
    // arrive the same way, and this page keeps them that way.
    if (err?.status === 404 || err?.status === 401) notFound();
    throw err;
  }

  const event = order.event || {};
  const tickets = Array.isArray(order.tickets) ? order.tickets : [];

  /**
   * `formatEventTime`, not a private copy — it names the zone as "EST" rather
   * than printing the IANA identifier in brackets, which is what this page did
   * while My Tickets did something third. It also stops the silent fall back to
   * UTC this had: a missing zone showed a confidently wrong time rather than
   * the reader's own, labelled.
   */
  const when = event.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;
  const venue = event.venue?.name || null;

  // In parallel: the codes are independent, and an order of six should not
  // cost six sequential loopback round trips on a page opened at a door.
  const codes = await Promise.all(tickets.map((t) => qrDataUri(t.qr)));

  const single = tickets.length === 1;

  return (
    <main className="es-ticket-page fx-section fx-section--sm">
      <TicketPrintStyles />
      <div className="fx-container fx-container--sm fx-stack">
        <div className="fx-stack fx-stack--sm">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">
            {single ? 'Your ticket' : `Your tickets · ${tickets.length}`}
          </p>
          <h1 className="text-xl">{event.title || 'Ticket'}</h1>
          {when && <p className="text-muted">{when}</p>}
          {venue && <p className="text-muted">{venue}</p>}
          {event.cancelled && (
            <p className="es-notice es-notice--warning">
              This event has been cancelled. Your ticket is kept for your records; the
              organizer will be in touch about a refund.
            </p>
          )}
        </div>

        {tickets.length === 0 ? (
          /* Paid, but nothing was issued. Silence here is worse than saying so:
             the buyer is standing at a door with a page that looks like a
             ticket and is not one. */
          <p className="es-notice es-notice--warning">
            We cannot find the tickets for this order. Please contact the organizer before
            you travel — do not rely on this page at the door.
          </p>
        ) : (
          <div className="fx-stack">
            {tickets.map((ticket, i) => (
              <div key={ticket.id || i} className="fx-stack fx-stack--sm">
                {!single && (
                  <p className="es-nums text-center text-xs uppercase tracking-[0.1em] text-subtle">
                    Ticket {i + 1} of {tickets.length}
                  </p>
                )}
                {/* `prominent`: this page IS the ticket. The 132px list size was
                    carried over from My Tickets, where a stub sits beside three
                    others; here the code is what the door is trying to read. */}
                <TicketStub
                  ticket={ticket}
                  timeZone={event.timezone}
                  qrSrc={codes[i]}
                  prominent
                />
              </div>
            ))}
          </div>
        )}

        {tickets.length > 0 && (
          <p className="text-center text-sm text-subtle">
            Show {single ? 'this code' : 'these codes'} at the door. Screen brightness up —
            {single ? ' it is' : ' they are'} read by a camera.
          </p>
        )}

        {/* The way to keep it. This page is the only copy a guest buyer has,
            and until now it offered no way to save one. */}
        <SaveTicket />

        {event.slug && (
          <Link href={`/e/${event.slug}`} className="es-ticket-print-hide fx-touch text-sm text-accent">
            About this event →
          </Link>
        )}
      </div>
    </main>
  );
}
