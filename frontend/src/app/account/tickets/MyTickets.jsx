'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, PUBLIC_API_URL } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import TicketStub from '../../components/TicketStub';
import TransferDialog from './TransferDialog';
import { Loading } from '../../components/Feedback';

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

  if (error) {
    const { title, recovery } = describeError(error);
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
      </div>
    );
  }

  if (!orders) return <Loading variant="list" />;

  if (orders.length === 0) {
    return (
      <div className="es-empty">
        <p className="text-muted">No tickets yet.</p>
        <Link href="/events" className="mt-2 inline-block text-sm text-accent">
          Find something to go to
        </Link>
      </div>
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
                {order.event?.startsAt && new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'medium', timeStyle: 'short',
                }).format(new Date(order.event.startsAt))}
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
            <p className="rounded-[--es-radius-md] bg-danger/10 px-3 py-2.5 text-sm text-muted">
              This event was cancelled. Your tickets are kept as a record — any refund is
              arranged with the organizer.
            </p>
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
