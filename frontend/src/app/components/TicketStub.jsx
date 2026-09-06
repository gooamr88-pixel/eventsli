/**
 * One ticket, with the code that opens the door.
 *
 * The QR is a plain <img> pointing at `GET /public/qr/:token`, which the API
 * renders itself after checking the signature. It is NOT generated in the
 * browser and it is NOT fetched from a QR service — the previous platform did
 * the latter, which put the credential that admits someone into a third party's
 * access logs for every ticket ever sold.
 *
 * A server component: nothing here is interactive, so shipping it to the
 * browser would be bytes for no behaviour.
 */
export default function TicketStub({ ticket, qrSrc }) {
  const used = ticket.status === 'scanned' || Boolean(ticket.scannedAt);
  const void_ = ticket.status === 'void';

  return (
    <article className="fx-row items-start gap-4 rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <div className="relative flex-none">
        {/* A plain img, not next/image: this is a same-origin API response with
            no fixed dimensions to optimise, and routing it through the image
            proxy would cache a credential. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt={`Entry code for ${seatLabel(ticket) || 'this ticket'}`}
          width={132}
          height={132}
          className={`h-[132px] w-[132px] rounded-[--es-radius-sm] bg-white p-1 ${used || void_ ? 'opacity-30' : ''}`}
        />
        {(used || void_) && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="rounded-[--es-radius-sm] bg-ink/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.09em] text-bg">
              {void_ ? 'Void' : 'Used'}
            </span>
          </span>
        )}
      </div>

      <div className="fx-min0 fx-stack fx-stack--sm">
        {ticket.attendeeName && <p className="text-ink">{ticket.attendeeName}</p>}

        <p className="es-nums text-sm text-muted">
          {seatLabel(ticket) || 'General admission'}
        </p>

        {/* "Already used" starts an argument at the door; "already used at
            19:04" ends one. The time is the whole value of this line. */}
        {ticket.scannedAt && (
          <p className="text-xs text-subtle">
            Scanned {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
              .format(new Date(ticket.scannedAt))}
          </p>
        )}

        {ticket.transferred && (
          <p className="text-xs text-subtle">Transferred — this ticket cannot be passed on again.</p>
        )}
      </div>
    </article>
  );
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
