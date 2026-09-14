'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, PUBLIC_API_URL } from '../../utils/apiClient';
import { formatMoney } from '../../utils/money';
import TicketStub from '../../components/TicketStub';
import TransferDialog from './TransferDialog';
import { Loading, Empty, ErrorNotice, Notice } from '../../components/Feedback';

/** In the EVENT's timezone, with the zone named — a ticket is read before travelling. */
function eventTime(event) {
  const opts = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    const text = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: event.timezone || undefined })
      .format(new Date(event.startsAt));
    return event.timezone ? `${text} (${event.timezone})` : text;
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(new Date(event.startsAt));
  }
}

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/tickets', { cache: 'no-store' });
        if (!cancelled) { setOrders(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

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

  return (
    <div className="fx-stack">
      {orders.map((order) => (
        <section key={order.orderId} className="fx-stack fx-stack--sm">
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
            <p className="es-nums whitespace-nowrap text-sm text-muted">
              {formatMoney(order.totalCents, order.currency)}
            </p>
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
