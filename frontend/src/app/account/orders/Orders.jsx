'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { useAccountOrders } from '../nav/AccountOrders';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDERS — the transactions, as opposed to the admissions they bought.
 *
 * THE WORDS WERE THE PROBLEM BEFORE THE SCREEN WAS. `GET /tickets` returns the
 * buyer's ORDERS, each carrying its tickets, and "My tickets" rendered that whole
 * payload as one list. So the receipt, the QR code and the event were one object
 * on screen: somebody looking for what they paid had to read a ticket, and
 * somebody looking for the QR code had to scroll past a total.
 *
 * Section 6 of the brief names the three nouns that had collapsed into one:
 *
 *     EVENTS   things being discovered — they belong to organizers
 *     TICKETS  admissions this person owns, and the QR code that admits them
 *     ORDERS   the purchases, with what each one cost
 *
 * ONE REQUEST STILL. This is the shell's `GET /tickets` payload read as receipts
 * — no second endpoint, so there is no way for the two screens to disagree about
 * what was bought. `AccountOrders.jsx` argues why the fetch is in the layout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO INVOICE OR REFUND CONTROL HERE.
 *
 * Neither exists for a buyer. The API has commission invoices, which are
 * Eventsli billing an organizer and are nothing to do with this account, and BRD
 * §17 is explicit that tickets are non-refundable by default and that any refund
 * is arranged between the buyer and the organizer. A "request a refund" button
 * would be a promise no endpoint keeps.
 *
 * What a buyer can actually do with a past purchase is open its tickets, so that
 * is the action every row carries.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Orders() {
  const { orders, error, loading, reload } = useAccountOrders();

  /**
   * Most recent purchase first — a history reads backwards.
   *
   * Sorted on `purchasedAt` rather than on the event date, and the difference is
   * the whole reason this is a separate screen: My tickets is ordered by WHEN YOU
   * ARE GOING, because that is what a ticket is for. A list of purchases is
   * ordered by when you bought, because that is what a receipt is for. Two
   * orderings of one payload, each right for its own question.
   */
  const rows = useMemo(
    () => [...(orders || [])].sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0)),
    [orders],
  );

  // The failure first: `orders` is null both when a request failed and when it
  // has not answered, and only one of those may render "nothing here".
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading) return <Loading variant="list" rows={3} label="Loading your orders" />;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Yours"
        title="Orders"
        lede="Every purchase made with this account, and what each one cost."
      />

      {rows.length === 0 ? (
        <Empty
          title="No orders yet."
          hint="Anything you buy — signed in or as a guest with this email address — is listed here with its total."
          action={{ href: '/events', label: 'Find something to go to' }}
        />
      ) : (
        <ul className="es-deflist">
          {rows.map((order) => <Row key={order.orderId} order={order} />)}
        </ul>
      )}
    </div>
  );
}

/**
 * One purchase.
 *
 * `.es-deflist__row`, the same row the organizer's order list uses, so the two
 * halves of the product describe a purchase the same way.
 *
 * THE CANCELLED FLAG IS STATED HERE TOO. It is on the ticket, and it belongs on
 * the receipt as well: this is the screen somebody opens when they are working
 * out what they paid for something that is not happening, and reading the row
 * without it would mean finding out on the next page.
 */
function Row({ order }) {
  const event = order.event || {};
  const count = order.tickets?.length || 0;

  return (
    <li className="es-deflist__row">
      <div className="fx-row fx-row--between w-full flex-nowrap items-start gap-3">
        <div className="fx-min0 flex-1">
          <p className="fx-break font-medium text-ink">
            {event.slug ? (
              <Link href={`/e/${event.slug}`} className="hover:text-accent">
                {event.title || 'Event'}
              </Link>
            ) : (event.title || 'Event')}
          </p>

          <p className="text-sm text-muted">
            {/* The purchase date, in the READER's zone and with no time — a
                receipt is about which day money moved, and the event's zone is
                irrelevant to that. The event's own date below keeps its zone,
                because that one is a place somebody has to be. */}
            {order.purchasedAt && `Bought ${formatEventTime(order.purchasedAt, undefined, { time: false })}`}
            {` · ${count} ${count === 1 ? 'ticket' : 'tickets'}`}
          </p>

          {event.startsAt && (
            <p className="text-sm text-subtle">
              {formatEventTime(event.startsAt, event.timezone)}
              {event.venue && ` · ${event.venue}`}
            </p>
          )}

          {event.cancelled && (
            <p className="text-sm text-danger">
              This event was cancelled. The tickets are kept as a record.
            </p>
          )}
        </div>

        <div className="fx-stack fx-stack--sm shrink-0 items-end gap-1">
          <p className="es-nums whitespace-nowrap font-medium text-ink">
            {formatMoney(order.totalCents, order.currency)}
          </p>
          <Link href="/account/tickets" className="es-btn es-btn--secondary es-btn--sm">
            Tickets
          </Link>
        </div>
      </div>
    </li>
  );
}
