'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PUBLIC_API_URL } from '../../utils/apiClient';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { splitOrders } from '../../lib/buyerOrders';
import TicketStub from '../../components/TicketStub';
import TransferDialog from './TransferDialog';
import TicketActions, { TicketPrintStyles } from './TicketActions';
import { Loading, Empty, ErrorNotice, Notice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { useAccountOrders } from '../nav/AccountOrders';

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
  /**
   * THE FETCH MOVED TO THE LAYOUT, and so did the instant it happened.
   *
   * Four things in this workspace ask `GET /tickets` — this screen, the
   * dashboard, Orders, and the sidebar's badge — so it is fetched once for the
   * shell and read from context. `nav/AccountOrders.jsx` argues it, including why
   * `loadedAt` has to travel WITH the payload rather than being captured here.
   *
   * The reason it was captured at all is unchanged and still the point: a
   * `Date.now()` inside the memo below would be impure, so the same render could
   * produce two different answers and an event ending mid-render would land in a
   * different group depending on when the memo happened to run.
   */
  const { orders, loadedAt, error, loading, reload } = useAccountOrders();
  const [transferring, setTransferring] = useState(null);
  const [when, setWhen] = useState('upcoming');
  // Which order is being saved as a PDF, so the print rules can hide the rest.
  const [printing, setPrinting] = useState(null);

  /**
   * Upcoming and past, split on the event's END rather than its start — the rule
   * and the reasoning now live in `lib/buyerOrders.js`, because the dashboard
   * splits the same payload and two copies of a date comparison is two chances
   * for one screen to say "next event tomorrow" while the other files that event
   * under Past.
   */
  const groups = useMemo(() => splitOrders(orders, loadedAt), [orders, loadedAt]);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;

  if (loading) return <Loading variant="list" label="Loading your tickets" />;

  /**
   * THE HEADING IS THIS SCREEN'S OWN NOW.
   *
   * It used to come from `account/layout.jsx`, which rendered the reader's NAME
   * as the `<h1>` for every page under it — so Tickets and Security had the same
   * top-level heading and neither said which page it was. The layout is a shell
   * with a sidebar now, exactly like the organizer's and the admin's, and in that
   * arrangement each page states what it is.
   */
  const head = (
    <PageHeader
      eyebrow="Yours"
      title="My tickets"
      lede="Everything this account can be admitted with. Keep the QR code to hand at the door."
    />
  );

  if (orders.length === 0) {
    return (
      <div className="fx-stack">
        {head}
        <Empty
          title="No tickets yet."
          hint="Tickets you buy with this email address — signed in or as a guest — appear here."
          action={<Link href="/events" className="es-btn es-btn--primary es-btn--sm">Find something to go to</Link>}
        />
      </div>
    );
  }

  const shown = groups[when];

  return (
    <div className="es-tickets-root fx-stack" {...(printing ? { 'data-printing': printing } : {})}>
      <TicketPrintStyles />
      {/* Print-hidden with the rest of the chrome: a PDF of a ticket does not
          need the page's lede above it. */}
      <div className="es-tickets-print-hide">{head}</div>

      {/* The switch appears only when there is something on both sides. On an
          account with three upcoming tickets and no history, a "Past (0)" tab
          is a control whose only function is to show an empty screen. */}
      {groups.upcoming.length > 0 && groups.past.length > 0 && (
        /**
         * ─────────────────────────────────────────────────────────────────────
         * `aria-pressed` TOGGLES, NOT `role="tablist"` — and the change is a
         * correction rather than a preference.
         *
         * This was a `tablist` of two `role="tab"` buttons. The tab pattern is a
         * CONTRACT with the reader, and it promises three things this markup did
         * not have: each tab `aria-controls` a `role="tabpanel"`, the panel is
         * labelled by its tab, and Left/Right arrows move between tabs while Tab
         * leaves the set entirely. None of those existed — there is no tabpanel
         * on this page at all, only a list that re-renders.
         *
         * So a screen-reader user was told "tab, 1 of 2, selected" and then
         * offered no panel to move into and no arrow keys that did anything,
         * while Tab walked into the ticket list which the announcement had just
         * implied was a separate region. Announced semantics that the page does
         * not implement are worse than none: they describe a way of moving around
         * that does not work here.
         *
         * Two toggle buttons in a labelled group is exactly what this is. It is
         * native button behaviour — Tab reaches them, Enter and Space press them
         * — so there is no keyboard handling to write and none to get wrong. This
         * is the brief's own rule: do not add ARIA where native semantics already
         * solve the problem.
         *
         * `aria-live` on the count below is not needed: pressing one of these
         * moves focus nowhere and the pressed state is announced by the button
         * itself, which is the change the reader asked for.
         * ─────────────────────────────────────────────────────────────────────
         */
        <div
          role="group"
          aria-label="Which tickets to show"
          className="es-tickets-print-hide fx-row gap-1 rounded-(--es-radius-md) bg-bg-sunken p-1"
        >
          {[['upcoming', 'Upcoming', groups.upcoming.length], ['past', 'Past', groups.past.length]].map(
            ([key, label, n]) => (
              <button
                key={key}
                type="button"
                aria-pressed={when === key}
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
          // Refetches the SHELL's copy, so the sidebar's badge and the dashboard
          // see the transferred ticket leave at the same moment this list does.
          onDone={() => { setTransferring(null); reload?.(); }}
        />
      )}
    </div>
  );
}
