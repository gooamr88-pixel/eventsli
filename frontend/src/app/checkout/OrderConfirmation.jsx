'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { PUBLIC_API_URL } from '../utils/apiClient';
import { formatMoney } from '../utils/money';
import { formatEventTime } from '../lib/eventTime';
import NavIcon from '../components/shell/NavIcon';
import PrintableTicket from './PrintableTicket';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER CONFIRMATION — the paid ending and the free one, one page
 * (owner's reference, 2026-11-15).
 *
 *   ✓  Payment successful / Your tickets are confirmed
 *      the statement line (paid) or where the email went (free)
 *   [Download PDF] [Select all] [Deselect all] [Print selected] [☐ Black and white]
 *   ☑ Include when printing
 *   ┌ the ticket ─────────────────────────────┬ logo + code ┐
 *
 * PRINTING IS THE BROWSER'S, as everywhere else in the product (TicketActions,
 * SaveTicket): every browser has a print engine that paginates and offers
 * "Save as PDF" in the same dialog, so "Download PDF" opens it with every
 * ticket, one per page, and says to choose Save as PDF. No PDF library is
 * shipped to every buyer to produce a worse copy of the same layout.
 *
 * "Print selected" prints only the ticked tickets — a family of five printing
 * the two they will hand to grandparents. "Black and white" drops the yellow
 * paper and the coral for an office printer; the code is black on white
 * either way.
 *
 * The print rules are mounted with this page (not in globals.css) because one
 * of them hides the whole application, and such a rule must not be reachable
 * from any other page. `visibility`, not `display`: see TicketPrintStyles for
 * the blank-page bug that taught that.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrderConfirmation({
  free = false,
  totalCents = 0,
  currency = 'CAD',
  email = null,
  event = null,
  tickets = [],
  ticketsWithheld = false,
  message = null,
  signedIn = false,
  holderName = null,
}) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [bw, setBw] = useState(false);
  const [mode, setMode] = useState(null); // 'all' | 'selected' while printing
  const [hint, setHint] = useState(null);

  const ids = tickets.map((t) => t.id);
  const chosen = ids.filter((id) => !excluded.has(id));
  const when = event?.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;

  const print = useCallback((which) => {
    setMode(which);
    setHint(which === 'all'
      ? 'Your browser’s print dialog is open — choose “Save as PDF” as the printer to download your tickets.'
      : null);
    /* Two frames, then print: `print()` blocks the main thread, and calling it
       in the same tick as the state change prints a layout React has not
       painted (TicketActions has the full story). */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        setMode(null);
      }
    }));
  }, []);

  const toggle = (id) => (e) => setExcluded((prev) => {
    const next = new Set(prev);
    if (e.target.checked) next.delete(id); else next.add(id);
    return next;
  });

  const hasTickets = !ticketsWithheld && tickets.length > 0;

  return (
    <div
      className="es-ordx"
      data-print={mode || undefined}
      data-bw={bw ? '' : undefined}
    >
      <OrderPrintStyles />

      <header className="es-ordx__head" role="status">
        <span className="es-ordx__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
            <path d="M5.5 12.5l4.2 4.2L18.5 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="es-ordx__title">{free ? 'Your tickets are confirmed' : 'Payment successful'}</h1>
        {free ? (
          <p className="es-ordx__lede">
            Thank you! Your free {tickets.length === 1 ? 'ticket is' : 'tickets are'} below
            {email ? <> and on the way to <b className="fx-break">{email}</b></> : null}.
          </p>
        ) : (
          <p className="es-ordx__lede">
            Thank you for your payment of <b className="es-nums">{formatMoney(totalCents, currency)}</b>.
            {' '}Your transaction will appear on your statement under{' '}
            <span className="es-ordx__em">&ldquo;Eventsli&rdquo;</span>
            {event?.organizerName && <> or <span className="es-ordx__em fx-break">&ldquo;{event.organizerName}&rdquo;</span></>}.
          </p>
        )}
        {!free && email && (
          <p className="es-ordx__sub">A confirmation and your tickets have been sent to <b className="fx-break">{email}</b>.</p>
        )}
        {event?.title && (
          <p className="es-ordx__event">
            <b className="fx-break">{event.title}</b>
            {(when || event.venue) && <span>{[when, event.venue].filter(Boolean).join(' · ')}</span>}
          </p>
        )}
      </header>

      {hasTickets && (
        <section className="es-ordx__tools" aria-label="Save and print your tickets">
          <div className="es-ordx__bar">
            <button type="button" className="es-ordx__btn es-ordx__btn--pdf" onClick={() => print('all')} disabled={mode !== null}>
              <NavIcon name="download" size={20} /> Download PDF
            </button>
            <button type="button" className="es-ordx__btn" onClick={() => setExcluded(new Set())} disabled={chosen.length === ids.length}>
              Select all
            </button>
            <button type="button" className="es-ordx__btn" onClick={() => setExcluded(new Set(ids))} disabled={chosen.length === 0}>
              Deselect all
            </button>
            <button type="button" className="es-ordx__btn" onClick={() => print('selected')} disabled={chosen.length === 0 || mode !== null}>
              Print selected tickets{chosen.length > 0 && chosen.length < ids.length ? ` (${chosen.length})` : ''}
            </button>
            <label className="es-ordx__btn es-ordx__bw">
              <input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} />
              Print in black and white
            </label>
          </div>
          <p className="es-ordx__note" aria-live="polite">
            {hint || 'Download PDF opens your browser’s print dialog with every ticket — choose “Save as PDF” to keep a copy that scans with no signal.'}
          </p>
          <p className="es-ordx__note">
            Print selected opens the same dialog with only the tickets ticked below, one ticket per page, on paper or
            as a PDF. Turn on black and white to use less ink.
          </p>
        </section>
      )}

      {hasTickets ? (
        <ol className="es-ordx__list">
          {tickets.map((ticket, i) => {
            const included = !excluded.has(ticket.id);
            return (
              <li key={ticket.id} className="es-ordx__item" data-include={included ? 'yes' : 'no'}>
                <label className="es-ordx__include">
                  <input type="checkbox" checked={included} onChange={toggle(ticket.id)} />
                  Include when printing
                  {tickets.length > 1 && <span className="es-ordx__count">Ticket {i + 1} of {tickets.length}</span>}
                </label>
                <PrintableTicket
                  ticket={ticket}
                  event={event}
                  free={free}
                  holderName={holderName}
                  qrSrc={ticket.qr ? `${PUBLIC_API_URL}/public/qr/${encodeURIComponent(ticket.qr)}` : null}
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="es-ordx__empty">
          <NavIcon name="mail" size={22} />
          <p>{message || 'Your tickets are in your email — open the link there to show them at the door.'}</p>
        </div>
      )}

      <nav className="es-ordx__next" aria-label="What next">
        <Link href={signedIn ? '/account/tickets' : '/tickets/find'} className="es-btn es-btn--primary es-btn--lg">
          {signedIn ? 'View my tickets' : 'Find my tickets'}
        </Link>
        <Link href={event?.slug ? `/e/${event.slug}` : '/events'} className="es-btn es-btn--secondary es-btn--lg">
          {event?.slug ? 'Back to the event' : 'Browse more events'}
        </Link>
      </nav>
      <p className="es-ordx__keep">Keep the email — its link opens your tickets on any device.</p>
    </div>
  );
}

/**
 * The print rules for this page, mounted with it. Everything but the tickets
 * is hidden; each ticket gets its own page; "selected" drops the unticked
 * ones; black and white drops the paper colours.
 */
function OrderPrintStyles() {
  return (
    <style>{`
      @media print {
        @page { margin: 12mm; }
        body * { visibility: hidden; }
        .es-ordx__list, .es-ordx__list * { visibility: visible; }
        .es-ordx__list { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
        .es-ordx__include { display: none; }
        .es-ordx[data-print='selected'] .es-ordx__item[data-include='no'] { display: none; }
        .es-ordx__item { break-inside: avoid; break-after: page; }
        .es-ordx__item:last-child { break-after: auto; }
        .es-ptk { box-shadow: none; }
        .es-ordx[data-bw] .es-ptk { filter: grayscale(1); --ptk-paper: #ffffff; --ptk-stub: #ffffff; --ptk-frame: #111018; }
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    `}</style>
  );
}
