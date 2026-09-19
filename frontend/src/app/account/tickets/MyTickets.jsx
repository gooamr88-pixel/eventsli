'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { get, PUBLIC_API_URL } from '../../utils/apiClient';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import TicketStub from '../../components/TicketStub';
import TransferDialog from './TransferDialog';
import TicketActions, { TicketPrintStyles } from './TicketActions';
import { Loading, Empty, ErrorNotice, Notice } from '../../components/Feedback';

/**
 * In the EVENT's timezone, with the zone named — a ticket is read before
 * travelling.
 *
 * `formatEventTime`, not a fourth private copy. The three ticket screens each
 * had their own: this one printed "8:00 PM (America/Toronto)", `/t/[token]`
 * printed "Sunday, June 1, 2027 at 8:00 PM (America/Toronto)", and the stub
 * between them printed no zone at all. Three renderings of one fact, on three
 * screens showing the same ticket. The shared helper says "8:00 PM EST" — the
 * short name a reader can act on rather than an IANA identifier — and handles
 * the unknown-zone fallback that each copy re-implemented.
 */
const eventTime = (event) => formatEventTime(event.startsAt, event.timezone);

/**
 * Every ticket this account has, grouped by the order that bought it.
 *
 * `GET /tickets` matches on the account id OR on the address a guest bought
 * with, so a purchase made before signing up still appears here. That is the
 * whole reason the endpoint takes no parameters: the API decides what "mine"
 * means, and it means more than one thing.
 */
export default function MyTickets() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [reload, setReload] = useState(0);
  const [when, setWhen] = useState('upcoming');
  // Which order is being saved as a PDF, so the print rules can hide the rest.
  const [printing, setPrinting] = useState(null);
  /**
   * The instant the list was fetched, used to split upcoming from past.
   *
   * `Date.now()` inside the memo below is impure — React's compiler refuses it,
   * and it is right to: the same render could produce two different answers,
   * and an event ending mid-render would land in different groups depending on
   * when the memo happened to run. Captured once, beside the data it describes,
   * so the split is consistent with the list it is splitting.
   */
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/tickets', { cache: 'no-store' });
        if (!cancelled) {
          setOrders(Array.isArray(data) ? data : []);
          setLoadedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * UPCOMING AND PAST, split on the event's END, not its start.
   *
   * An event that started an hour ago has not happened yet as far as somebody
   * standing outside it is concerned — they are still going to it, and they
   * still need the QR code on this screen. Splitting on `startsAt` files the
   * ticket under "Past" while the doors are open, which is exactly when it is
   * needed most.
   *
   * `endsAt` is on every event (the schema requires it and refuses an end
   * before a start), so there is no fallback branch to get wrong.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const groups = useMemo(() => {
    const now = loadedAt ?? 0;
    const upcoming = [];
    const past = [];
    for (const order of orders || []) {
      const ends = new Date(order.event?.endsAt || order.event?.startsAt || 0).getTime();
      (Number.isFinite(ends) && ends >= now ? upcoming : past).push(order);
    }
    // Soonest first for what is coming; most recent first for what is done.
    upcoming.sort((a, b) => new Date(a.event?.startsAt || 0) - new Date(b.event?.startsAt || 0));
    past.sort((a, b) => new Date(b.event?.startsAt || 0) - new Date(a.event?.startsAt || 0));
    return { upcoming, past };
  }, [orders, loadedAt]);

  if (error) return <ErrorNotice error={error} />;

  if (!orders) return <Loading variant="list" label="Loading your tickets" />;

  if (orders.length === 0) {
    return (
      <Empty
        title="No tickets yet."
        hint="Tickets you buy with this email address — signed in or as a guest — appear here."
        action={<Link href="/events" className="es-btn es-btn--primary es-btn--sm">Find something to go to</Link>}
      />
    );
  }

  const shown = groups[when];

  return (
    <div className="es-tickets-root fx-stack" {...(printing ? { 'data-printing': printing } : {})}>
      <TicketPrintStyles />

      {/* The switch appears only when there is something on both sides. On an
          account with three upcoming tickets and no history, a "Past (0)" tab
          is a control whose only function is to show an empty screen. */}
      {groups.upcoming.length > 0 && groups.past.length > 0 && (
        <div role="tablist" aria-label="Which tickets" className="es-tickets-print-hide fx-row gap-1 rounded-(--es-radius-md) bg-bg-sunken p-1">
          {[['upcoming', 'Upcoming', groups.upcoming.length], ['past', 'Past', groups.past.length]].map(
            ([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={when === key}
                onClick={() => setWhen(key)}
                className={`flex-1 rounded-(--es-radius-sm) px-4 py-2 text-sm transition-colors ${
                  when === key ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {label} <span className="es-nums text-subtle">({n})</span>
              </button>
            ),
          )}
        </div>
      )}

      {shown.length === 0 && (
        <Empty
          title={when === 'upcoming' ? 'Nothing coming up' : 'Nothing in the past'}
          hint={when === 'upcoming'
            ? 'Your past tickets are under Past.'
            : 'Events you have been to will collect here.'}
        />
      )}

      {shown.map((order) => (
        <section
          key={order.orderId}
          className="es-ticket-order fx-stack fx-stack--sm"
          {...(printing === order.orderId ? { 'data-printing-this': '' } : {})}
        >
          <header className="fx-row fx-row--between border-b border-border-base pb-2">
            <div className="fx-min0">
              <h2 className="fx-break text-lg">
                {order.event?.slug ? (
                  <Link href={`/e/${order.event.slug}`} className="hover:text-accent">
                    {order.event.title}
                  </Link>
                ) : (order.event?.title || 'Event')}
              </h2>
              <p className="text-sm text-muted">
                {order.event?.startsAt && eventTime(order.event)}
                {order.event?.venue && ` · ${order.event.venue}`}
              </p>
            </div>
            <div className="fx-row shrink-0 items-center gap-3">
              <p className="es-nums whitespace-nowrap text-sm text-muted">
                {formatMoney(order.totalCents, order.currency)}
              </p>
              {/* Print-hidden: a PDF of a ticket with a "Save as PDF" button on
                  it is a button somebody will try to press on paper. */}
              <span className="es-tickets-print-hide">
                <TicketActions orderId={order.orderId} onPrintingChange={setPrinting} />
              </span>
            </div>
          </header>

          {/* BRD §17 — a cancelled event keeps its tickets and says so. Deleting
              them would erase the buyer's own record of what they paid for, at
              exactly the moment they need it to talk to the organizer. */}
          {order.event?.cancelled && (
            <Notice tone="danger" title="This event was cancelled.">
              <p>
                Your tickets no longer admit anyone and are kept here as a record. Tickets are
                non-refundable by default; any refund is arranged between you and the organizer.
              </p>
            </Notice>
          )}

          <div className="fx-stack fx-stack--sm">
            {order.tickets.map((ticket) => (
              <div key={ticket.id} className="fx-stack fx-stack--sm">
                <TicketStub
                  ticket={ticket}
                  timeZone={order.event?.timezone}
                  qrSrc={`${PUBLIC_API_URL}/public/qr/${encodeURIComponent(ticket.qr)}`}
                />
                {/* BRD §10 — once only, and the organizer can switch it off.
                    Offered only where it can actually work: an already
                    transferred, used or void ticket gets no button rather than
                    a button that explains itself afterwards. */}
                {!ticket.transferred && ticket.status === 'valid' && !ticket.scannedAt && (
                  <button
                    type="button"
                    onClick={() => setTransferring({ ticket, event: order.event })}
                    className="self-start text-sm text-accent hover:text-accent-hover"
                  >
                    Give this ticket to someone
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {transferring && (
        <TransferDialog
          ticket={transferring.ticket}
          event={transferring.event}
          onClose={() => setTransferring(null)}
          onDone={() => { setTransferring(null); setReload((n) => n + 1); }}
        />
      )}
    </div>
  );
}
