'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { summariseOrders } from '../../lib/buyerOrders';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import { PageHeader, StatCard, Panel } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';
import { useAuth } from '../../hooks/useAuth';
import { useAccountOrders } from '../nav/AccountOrders';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUYER'S HOME — what is next, what needs them, and the way to more.
 *
 * There was no such page. The API's landing rule sent a buyer to
 * `/account/tickets`, and that was not a shortcut past a dashboard — it was the
 * only screen there was. So somebody who had just proved who they are arrived at
 * a list of QR codes with no answer to any of the five questions this pass is
 * about: the heading was their own name, the nav was two tabs, and the only
 * promoted action in the surrounding chrome was "Create event".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO NEW ENDPOINT, AND NO NEW NUMBERS.
 *
 * Every figure comes from `GET /tickets`, which the shell fetches once for the
 * whole workspace, and every one is derived by `summariseOrders` — so this page,
 * the tickets list and the sidebar's badge cannot disagree about what "upcoming"
 * means. `lib/buyerOrders.js` records which figures count a cancelled event and
 * which skip it, because that answer is different per figure.
 *
 * NO NEW COMPONENTS OR CLASSES EITHER. `.es-deflist`, `.es-steps`, `StatCard`
 * and `Panel` are what the organizer dashboard is built from, and the point of
 * this pass is that the two dashboards read as one product. A buyer's panel that
 * looked subtly different from an organizer's would be a second design system
 * arriving one card at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS WHAT NEEDS YOU, THEN WHAT IS NEXT, THEN THE NUMBERS.
 *
 * The same correction the organizer dashboard records making. Its panels sat in
 * a split that collapses to one column below 1280px, so "Needs you" — the only
 * thing on the page with anything to act on — was read third, under a chart.
 * Here a cancelled event comes first and full width: it is the one thing on this
 * payload a buyer has to act on, and it is worth nothing at the bottom of a
 * phone screen.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *
 *   A spend total.   It would have to add currencies. A Toronto order and a
 *                    Denver order are CAD and USD, and one "total spent" adding
 *                    them is wrong in both. The organizer dashboard hit this and
 *                    answers it with a currency switcher — a control a buyer has
 *                    no reason to operate. The amount is shown where it is
 *                    unambiguous: on each order.
 *   Notifications.   There is no such feature — no endpoint, no table, no
 *                    screen. An empty panel promising one is worse than nothing.
 *   Recommendations. There is no recommendation endpoint, and a "for you" rail
 *                    filled with the four newest events is a lie about how it
 *                    was chosen. Discover goes to the real browse page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BuyerDashboard() {
  const { user } = useAuth();
  const { orders, loadedAt, error, loading, reload } = useAccountOrders();

  const summary = useMemo(() => summariseOrders(orders, loadedAt), [orders, loadedAt]);

  /**
   * THE FAILURE IS TESTED FIRST, before the "you have nothing" branch.
   *
   * A request that did not answer leaves `orders` null, which is the same shape
   * as "not yet". Testing the error first is what stops a network failure
   * rendering "Nothing here yet" — a confident claim about somebody's account
   * that this page has no basis for making.
   */
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading) return <Loading variant="stats" rows={3} label="Loading your dashboard" />;

  // The first name only. "Welcome back, Yousef" is a greeting; the full name on
  // an account is a salutation — and it is what the old page used as its title.
  const firstName = String(user?.fullName || '').trim().split(/\s+/)[0] || null;

  if (summary.neverBought) return <FirstVisit firstName={firstName} />;

  const next = summary.nextEvent;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Your tickets"
        title={firstName ? `Welcome back, ${firstName}` : 'Your account'}
        lede="What is coming up, and everything you have bought."
      />

      {/* ── What needs you ──────────────────────────────────────────────────
          First, and full width. BRD §17 keeps a cancelled event's tickets and
          says so ON the ticket; this is the only place that says so BEFORE
          somebody goes looking for it. */}
      {summary.cancelled.length > 0 && (
        <Notice
          tone="danger"
          title={summary.cancelled.length === 1
            ? 'An event you have tickets for was cancelled.'
            : `${summary.cancelled.length} events you have tickets for were cancelled.`}
          action={{ href: '/account/tickets', label: 'See which' }}
        >
          <p>
            Those tickets are kept as a record and no longer admit anyone. Tickets are
            non-refundable by default; any refund is arranged between you and the organizer.
          </p>
        </Notice>
      )}

      {/* ── What is next ────────────────────────────────────────────────────
          Above the tiles. A count of upcoming tickets is a summary; the event
          somebody is actually going to next is the reason they opened this. */}
      {next ? <NextUp order={next} /> : <NothingComingUp />}

      <div className="es-statgrid">
        <StatCard
          label="Upcoming tickets"
          value={summary.upcomingCount}
          note="For events still to come"
          icon="ticket"
          href="/account/tickets"
        />
        <StatCard
          label="Orders"
          value={summary.orderCount}
          note="Every purchase on this account"
          icon="receipt"
          href="/account/orders"
        />
        <StatCard
          label="Been to"
          value={summary.pastCount}
          note={summary.pastCount === 1 ? 'One ticket, used or expired' : 'Tickets for events that have been'}
          icon="check"
        />
      </div>

      <RecentOrders orders={orders} />
    </div>
  );
}

/**
 * A FIRST-TIME BUYER GETS THE WAY IN, and nothing above it.
 *
 * Not the `Empty` component: this is not an absent list, it is the whole page for
 * an account in a perfectly ordinary state, and it has three things to say
 * rather than one. Tiles reading zero over two empty panels would push the only
 * useful action below the fold — the mistake the organizer dashboard's `isNew`
 * branch exists to avoid, and it makes the same shape here.
 *
 * `.es-onboard` and `.es-steps` are that branch's own furniture, reused. The
 * steps are NOT given `data-state="current"`: these are three things worth
 * knowing, not a sequence somebody is partway through, and the stepper's
 * progress line would claim a position this page cannot know.
 */
function FirstVisit({ firstName }) {
  const steps = [
    {
      key: 'find',
      title: 'Find an event',
      detail: 'Browse what is on, or search by city and date.',
    },
    {
      key: 'tickets',
      title: 'Your tickets arrive here',
      detail: 'Every ticket bought with this email address shows up under My tickets — including anything you bought as a guest before signing up.',
    },
    {
      key: 'elsewhere',
      title: 'Bought with another address?',
      detail: 'The link in that confirmation email opens those tickets directly, without an account.',
    },
  ];

  return (
    <div className="fx-stack">
      <section className="es-onboard es-band--field" aria-labelledby="buyer-onboard-title">
        <div className="fx-stack fx-stack--sm gap-4">
          <p className="es-eyebrow">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</p>
          <h1 id="buyer-onboard-title" className="max-w-[20ch] text-ink">
            Your tickets will live here.
          </h1>
          <p className="max-w-[46ch] text-muted">
            Nothing yet. Find something to go to, and every ticket you buy with this address
            collects on this page.
          </p>
          <div className="fx-row gap-2">
            <Link href="/events" className="es-btn es-btn--primary es-btn--lg">
              <NavIcon name="search" size={18} />
              Discover events
            </Link>
            <Link href="/tickets/find" className="es-btn es-btn--ghost">
              Find an existing ticket
            </Link>
          </div>
        </div>

        <ol className="es-steps rounded-(--es-radius-lg) bg-bg-sunken p-5" aria-label="How tickets work here">
          {steps.map((step, i) => (
            <li key={step.key} className="es-steps__item" data-state="upcoming">
              <span className="es-steps__marker" aria-hidden="true">{i + 1}</span>
              <div className="es-steps__body">
                <p className="es-steps__title">{step.title}</p>
                <p className="text-sm text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * The next event — the one thing on the page that is a place rather than a
 * number.
 *
 * THE BUTTON GOES TO THE TICKET, not to the event's public page. Somebody
 * reading this the evening before wants the QR code, and the event page is where
 * you go to buy a ticket you already have. The TITLE still links to the event,
 * for looking up the address.
 */
function NextUp({ order }) {
  const event = order.event || {};
  const count = order.tickets?.length || 0;

  return (
    <Panel title="Next up">
      <div className="fx-row fx-row--between items-start gap-4">
        <div className="fx-min0 fx-stack fx-stack--sm gap-1">
          <p className="fx-break text-lg text-ink">
            {event.slug ? (
              <Link href={`/e/${event.slug}`} className="hover:text-accent">{event.title}</Link>
            ) : (event.title || 'Event')}
          </p>
          {/* In the EVENT's zone with the zone named — a ticket is read before
              travelling, which is the rule every ticket screen here follows. */}
          {event.startsAt && (
            <p className="text-sm text-muted">{formatEventTime(event.startsAt, event.timezone)}</p>
          )}
          {event.venue && <p className="fx-break text-sm text-muted">{event.venue}</p>}
          <p className="es-nums text-sm text-subtle">
            {count} {count === 1 ? 'ticket' : 'tickets'} on this order
          </p>
        </div>

        <Link href="/account/tickets" className="es-btn es-btn--primary shrink-0">
          <NavIcon name="qr" size={18} />
          Open my tickets
        </Link>
      </div>
    </Panel>
  );
}

/**
 * NOT AN ERROR AND NOT A FIRST VISIT — an account whose events have all
 * happened, which is the ordinary state between one event and the next.
 *
 * It says which state it is and what to do about it, because "No events" with no
 * way onward is exactly the dead end this pass was asked to remove.
 */
function NothingComingUp() {
  return (
    <Panel title="Nothing coming up">
      <p className="text-sm text-muted">
        Every event you have tickets for has been and gone. Those tickets are kept under
        My tickets as a record.
      </p>
      <div className="fx-row gap-2 pt-1">
        <Link href="/events" className="es-btn es-btn--primary es-btn--sm">Discover events</Link>
        <Link href="/account/tickets" className="es-btn es-btn--secondary es-btn--sm">Past tickets</Link>
      </div>
    </Panel>
  );
}

/**
 * The three most recent purchases. Three, not the history — this is a dashboard,
 * and the history has its own screen with its own heading and its own totals.
 *
 * `.es-deflist` is the organizer dashboard's row list, so a buyer's recent
 * orders and an organizer's latest orders are the same object on screen.
 */
function RecentOrders({ orders }) {
  const recent = [...(orders || [])]
    .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0))
    .slice(0, 3);

  return (
    <Panel
      title="Recent orders"
      action={(
        <Link href="/account/orders" className="text-sm text-accent hover:text-accent-hover">
          All orders
        </Link>
      )}
    >
      <ul className="es-deflist">
        {recent.map((order) => {
          const count = order.tickets?.length || 0;
          return (
            <li key={order.orderId} className="es-deflist__row">
              <Link href="/account/orders" className="fx-row fx-row--between group w-full flex-nowrap">
                <span className="fx-min0 flex-1">
                  <span className="fx-truncate block font-medium text-ink group-hover:text-accent">
                    {order.event?.title || 'Event'}
                  </span>
                  <span className="fx-truncate block text-sm text-muted">
                    {count} {count === 1 ? 'ticket' : 'tickets'}
                    {order.purchasedAt
                      && ` · ${formatEventTime(order.purchasedAt, undefined, { time: false })}`}
                  </span>
                </span>
                <span className="es-nums whitespace-nowrap text-sm text-ink">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
