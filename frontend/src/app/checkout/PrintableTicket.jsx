import { formatEventTime } from '../lib/eventTime';
import { ticketFacts } from '../components/TicketStub';
import Logo from '../components/brand/Logo';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One ticket as the order confirmation shows and prints it (owner's
 * reference, 2026-11-15): a pale-yellow ticket with its type, the event in a
 * starred heading, the holder and the place as labelled facts, a dotted rule
 * and the start time — and a perforated tear-off carrying the logo and the
 * code. In our brand: coral where the reference is pink, the sun yellow for
 * the paper.
 *
 * PAPER IN BOTH THEMES. A ticket is an object, not a panel of the interface;
 * it prints on white paper, and a dark-mode ticket on screen would be a
 * different ticket from the one in the PDF. Its colours are its own (set in
 * `.es-ptk`), and the code always sits on white, as `TicketStub` explains:
 * a scanner at a dark door reads contrast and a quiet margin.
 *
 * THE REFERENCE'S "CODE" LINE IS LEFT OUT, for the reason `TicketStub` gives
 * for the order id: nothing in the organizer or support tools can look a
 * ticket up by a short code yet, so printing one would hand the holder a
 * number nobody can use. The QR is the code.
 *
 * Pure (no hooks), so a server component may render it too.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PrintableTicket({ ticket, event, qrSrc, free = false, holderName = null }) {
  const when = event?.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;
  const facts = ticketFacts(ticket).filter(([label]) => label !== 'Ticket type');
  const name = ticket.attendeeName || holderName;
  const unusable = ticket.status === 'void' || ticket.status === 'scanned' || Boolean(ticket.scannedAt);

  return (
    <article className="es-ptk" aria-label={`Ticket${ticket.tierName ? `: ${ticket.tierName}` : ''}`}>
      <div className="es-ptk__main">
        <div className="es-ptk__frame">
          {ticket.tierName && (
            <p className="es-ptk__type">Ticket type: <b className="fx-break">{ticket.tierName}</b></p>
          )}
          <p className="es-ptk__title">
            <span aria-hidden="true" className="es-ptk__star">★</span>
            <span className="fx-break"><span className="es-ptk__tickets">Tickets</span> {event?.title}</span>
            <span aria-hidden="true" className="es-ptk__star">★</span>
          </p>

          <dl className="es-ptk__facts">
            {name && <div><dt>Name:</dt><dd className="fx-break">{name}</dd></div>}
            {free && <div><dt>Price:</dt><dd className="es-ptk__free">Free ticket</dd></div>}
            {facts.map(([label, value]) => (
              <div key={label}><dt>{label}:</dt><dd className="es-nums fx-break">{value}</dd></div>
            ))}
            {event?.venue && <div><dt>Location:</dt><dd className="fx-break">{event.venue}</dd></div>}
            {event?.venueAddress && (
              <div className="es-ptk__wide"><dt>Address:</dt><dd className="fx-break">{event.venueAddress}</dd></div>
            )}
          </dl>

          <span className="es-ptk__dots" aria-hidden="true" />
          {when && (
            <p className="es-ptk__when"><NavIcon name="calendar" size={16} /> Starts {when}</p>
          )}
        </div>
      </div>

      <div className="es-ptk__stub">
        <div className="es-ptk__brand" aria-hidden="true">
          <Logo size="sm" tagline />
        </div>
        <div className="es-ptk__qr">
          {qrSrc ? (
            /* A plain img: a same-origin API response, never through the image
               proxy (that would cache a credential). See TicketStub. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={qrSrc}
              alt={`Entry code${ticket.tierName ? ` for ${ticket.tierName}` : ''}`}
              width={160}
              height={160}
              className={unusable ? 'opacity-30' : undefined}
            />
          ) : (
            <p className="es-ptk__nocode">
              {ticket.transferredAway ? 'Given away — the new holder has the code.' : 'Code unavailable — open the link in your email.'}
            </p>
          )}
        </div>
        <p className="es-ptk__scan">Scan at entry</p>
      </div>
    </article>
  );
}
