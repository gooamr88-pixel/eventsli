import { formatEventTime } from '../lib/eventTime';
import Logo, { LogoMark } from './brand/Logo';
import NavIcon from './shell/NavIcon';

/**
 * One ticket, with the code that opens the door.
 *
 * REDRAWN 2026-10-16 after the brand guide's "Digital ticket example": a teal
 * stub carrying the reversed logo and a thank-you line, the details in the
 * middle (event, time, venue, then ticket type and seat as labelled facts), and
 * a perforated tear-off holding the code and "Scan at entry". It was a plain
 * card with a QR beside a line of text.
 *
 * WHAT THE REDESIGN WAS NOT ALLOWED TO TOUCH is the code itself. The QR stays
 * on a white pad at full size with nothing behind it, because a cheap fixed-
 * focus scanner at a dark door reads contrast and quiet margin, not branding.
 * The teal is all on the stub, never under the code.
 *
 * The QR is a plain <img> pointing at `GET /public/qr/:token`, which the API
 * renders itself after checking the signature. It is NOT generated in the
 * browser and it is NOT fetched from a QR service — the previous platform did
 * the latter, which put the credential that admits someone into a third party's
 * access logs for every ticket ever sold.
 *
 * A server component: nothing here is interactive, so shipping it to the
 * browser would be bytes for no behaviour.
 *
 * THE GUIDE'S "ORDER ID" FIELD IS LEFT OUT, deliberately. Nothing in the admin
 * or organizer tools can look an order up by a short reference, so printing one
 * would hand buyers a code that support cannot use. It belongs on the ticket
 * the day there is a search behind it.
 */
/**
 * `prominent` is for the page where the ticket is the ONLY thing — `/t/[token]`,
 * the link from the email, opened at a door.
 *
 * The list size is for My Tickets and the confirmation, where a ticket sits
 * beside others and identifying it matters more than reading the code. At a
 * door none of that is true — the code is the entire purpose of the screen, and
 * a small one, held at arm's length under a venue's lighting for a scanner that
 * is often a cheap fixed-focus camera, is the difference between one attempt
 * and four while a queue waits. So the door ticket always stacks, and the code
 * gets the full width of a phone.
 *
 * `event` is optional — `{ title, startsAt, timezone, venue }`, where `venue`
 * may be a name or `{ name }` (the three callers receive it in both shapes).
 * With it the ticket stands on its own when it is saved or printed, which is
 * the point of a ticket; without it the ticket shows only what is on it.
 */
export default function TicketStub({ ticket, qrSrc, timeZone = null, prominent = false, event = null }) {
  const used = ticket.status === 'scanned' || Boolean(ticket.scannedAt);
  const void_ = ticket.status === 'void';
  const zone = event?.timezone || timeZone;
  const when = event?.startsAt ? formatEventTime(event.startsAt, zone) : null;
  const venue = typeof event?.venue === 'string' ? event.venue : event?.venue?.name || null;
  const facts = ticketFacts(ticket);

  return (
    // Two elements, not one: the article is the size CONTAINER and the card
    // inside it is the grid that changes shape. An element cannot answer a
    // container query about itself.
    <article className={`es-ticket-stub es-tkt ${prominent ? 'es-tkt--door' : ''}`}>
      <div className="es-tkt__card">
        {/* THE STUB — the guide's reversed logo on teal. Decorative throughout:
            the thank-you line is a courtesy, and a screen reader is better served
            starting at the event than at a slogan. */}
        <div className="es-tkt__stub" aria-hidden="true">
          <Logo />
          <p className="es-tkt__thanks">Thank you for choosing Eventsli. Enjoy the event!</p>
          <LogoMark className="es-tkt__watermark" />
        </div>

        <div className="es-tkt__body">
          {event?.title && <p className="es-tkt__title fx-break">{event.title}</p>}
          {when && (
            <p className="es-tkt__line"><NavIcon name="clock" size={16} />{when}</p>
          )}
          {venue && (
            <p className="es-tkt__line"><NavIcon name="pin" size={16} /><span className="fx-break">{venue}</span></p>
          )}

          <dl className="es-tkt__facts">
            {facts.map(([label, value]) => (
              <div key={label} className="fx-min0">
                <dt>{label}</dt>
                <dd className="es-nums fx-break">{value}</dd>
              </div>
            ))}
          </dl>

          {/* "Already used" starts an argument at the door; "already used at
              19:04" ends one. The time is the whole value of this line.

              ON THE VENUE'S CLOCK. `formatEventTime` names the zone it used, so
              the one line whose entire job is settling a dispute at a door can
              actually settle it — a traveller's phone still on home time, or a
              tablet left on UTC, would otherwise print a confidently wrong time.
              Without a zone it falls back to the reader's, labelled. */}
          {ticket.scannedAt && (
            <p className="text-xs text-subtle">
              Scanned {formatEventTime(ticket.scannedAt, zone)}
            </p>
          )}

          {ticket.transferred && (
            <p className="text-xs text-subtle">Transferred — this ticket cannot be passed on again.</p>
          )}
        </div>

        {/* THE TEAR-OFF. The dashed edge and the two notches are the perforation
            from the guide; they are drawn in CSS so they cost nothing to print. */}
        <div className="es-tkt__code">
          <span aria-hidden="true" className="es-tkt__brand"><Logo size="sm" /></span>
          <div className="es-tkt__qr">
            {/* A plain img, not next/image: this is a same-origin API response
                with no fixed dimensions to optimise, and routing it through the
                image proxy would cache a credential. */}
            {/* A MISSING CODE SAYS SO, rather than rendering as a broken image.
                `<img src={undefined}>` draws the browser's torn-page glyph beside
                the alt text, which on a ticket reads as "the site is broken" and
                tells the holder nothing about what to do. This is not
                hypothetical: it is what /t/[token] showed for every ticket it ever
                served, because it was reading `qr` off an object that does not
                carry one. */}
            {!qrSrc ? (
              <div className="es-tkt__missing">
                Code unavailable — reload, or ask the organizer to resend your ticket.
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrSrc}
                alt={`Entry code for ${seatLabel(ticket) || 'this ticket'}`}
                width={prominent ? 288 : 132}
                height={prominent ? 288 : 132}
                className={`es-tkt__img ${used || void_ ? 'opacity-30' : ''}`}
              />
            )}
            {(used || void_) && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="rounded-(--es-radius-sm) bg-ink/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-bg">
                  {void_ ? 'Void' : 'Used'}
                </span>
              </span>
            )}
          </div>
          {/* The door page says "screen brightness up" once, under every code;
              repeating it on each ticket would say it twice per ticket. */}
          <p className="es-tkt__scan">Scan at entry</p>
        </div>
      </div>
    </article>
  );
}

/**
 * The labelled facts under the venue, in the guide's order: ticket type first,
 * then where to sit, then whose ticket it is.
 *
 * WHERE TO SIT HAS FOUR SHAPES, and each is named the way the door staff will
 * look for it:
 *   · a reserved seat     → Section · Row · Seat
 *   · a table booking     → Table · Seat  (its section IS the table's label,
 *                           and `row_label` is 'A' for every table seat, so
 *                           printing either would only repeat the table)
 *   · a whole table       → Table  (when no single seat is named)
 *   · general admission   → Admission: General admission (unless the ticket
 *                           type already says it)
 */
export function ticketFacts(ticket) {
  const facts = [];
  if (ticket.tierName) facts.push(['Ticket type', ticket.tierName]);

  const seat = ticket.seat;
  if (ticket.table) {
    facts.push(['Table', ticket.table]);
    if (seat?.number != null) facts.push(['Seat', String(seat.number)]);
  } else if (seat) {
    if (seat.section) facts.push(['Section', seat.section]);
    // Row 'A' is left out, as the line under the code always did: a seat sold
    // on its own at a table arrives without `ticket.table`, with the table's
    // label as its section and 'A' as its row, and the data cannot tell that
    // apart from a theatre's real row A. Printing "Row A" under a table's name
    // is the commoner mistake of the two.
    if (seat.row && seat.row !== 'A') facts.push(['Row', seat.row]);
    if (seat.number != null) facts.push(['Seat', String(seat.number)]);
  } else if (!/general|admission/i.test(ticket.tierName || '')) {
    // No seat: say so — unless the ticket type already does ("General
    // Admission" twice in a row reads as a rendering fault).
    facts.push(['Admission', 'General admission']);
  }

  if (ticket.attendeeName) facts.push(['Name', ticket.attendeeName]);
  return facts;
}

function seatLabel(ticket) {
  if (ticket.table) return `Table ${ticket.table}`;
  if (!ticket.seat) return null;
  const { section, row, number } = ticket.seat;
  // `row_label` is 'A' for every table-attached seat, so repeating it beside a
  // section that is already the table's name reads as noise.
  return row && row !== 'A'
    ? `${section} · row ${row} · seat ${number}`
    : `${section} · seat ${number}`;
}
