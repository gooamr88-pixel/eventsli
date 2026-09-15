import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { Panel } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The dashboard's panels. Each is empty-safe and says what an empty list MEANS
 * rather than showing a blank card.
 */

/**
 * The first screen for an organizer with no events: the whole road to a first
 * sale, with where they are on it. On the emerald field, because this is the
 * one moment the dashboard is selling the product rather than reporting on it.
 */
export function GettingStarted({ organizer }) {
  const payoutsReady = Boolean(organizer.canReceivePayouts);
  const steps = [
    { key: 'profile', state: 'done', title: 'Organizer profile', detail: `Buyers see you as ${organizer.displayName}.` },
    { key: 'event', state: 'current', title: 'Create your first event', detail: 'Title, date and venue. It stays a private draft until you submit it.' },
    { key: 'build', state: 'upcoming', title: 'Add ticket types and the seat map', detail: 'The prices, and the seats you sell.' },
    {
      key: 'payouts',
      state: payoutsReady ? 'done' : 'upcoming',
      title: 'Connect payouts',
      detail: payoutsReady ? 'Your Stripe account is ready to be paid.' : 'So card sales reach your Stripe account. You can do this any time before going on sale.',
      href: payoutsReady ? null : '/organizer/payouts',
      cta: organizer.stripeConnected ? 'Finish the Stripe setup' : 'Connect Stripe',
    },
    { key: 'review', state: 'upcoming', title: 'Accept the terms and submit', detail: 'Eventsli reviews it — usually within a day — and then it goes on sale.' },
  ];

  return (
    <section className="es-onboard es-band--field" aria-labelledby="onboard-title">
      <div className="fx-stack fx-stack--sm gap-4">
        <p className="es-eyebrow">Welcome to Eventsli</p>
        <h2 id="onboard-title" className="max-w-[16ch] text-3xl text-ink">Let’s put your first event on sale.</h2>
        <p className="max-w-[46ch] text-muted">
          Build it at your own pace — everything saves as you go, and nothing is public until you
          submit it and Eventsli approves it.
        </p>
        <div className="fx-row">
          <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg">
            <NavIcon name="plus" size={18} />
            Create your first event
          </Link>
        </div>
      </div>

      <ol className="es-steps rounded-(--es-radius-lg) bg-bg-sunken p-5">
        {steps.map((step, i) => (
          <li key={step.key} className="es-steps__item" data-state={step.state}>
            <span className="es-steps__marker" aria-hidden="true">
              {step.state === 'done' ? <NavIcon name="tick" size={16} /> : i + 1}
            </span>
            <div className="es-steps__body">
              <p className="es-steps__title">
                {step.title}
                {step.state === 'done' && <span className="sr-only"> — done</span>}
              </p>
              <p className="text-sm text-muted">{step.detail}</p>
              {step.href && (
                <Link href={step.href} className="self-start text-sm text-accent hover:text-accent-hover">
                  {step.cta} <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "What needs you." Each line is a count with the place to deal with it —
 * a number with nowhere to go is a worry, not a task. The payout account is the
 * first line when it is missing; the dashboard shows it nowhere else.
 *
 * In review is listed but not as a task: that one is waiting on Eventsli.
 */
export function Attention({ data, organizer }) {
  const items = [];
  const { draft = 0, rejected = 0, pendingReview = 0 } = data.events || {};
  const overdue = data.invoices?.overdue || 0;

  if (overdue > 0) {
    items.push({
      key: 'overdue',
      icon: 'alert',
      tone: 'danger',
      text: `${overdue} commission ${overdue === 1 ? 'invoice is' : 'invoices are'} overdue — scanning is off for ${overdue === 1 ? 'that event' : 'those events'}.`,
      href: '/organizer/events?status=published',
      cta: 'Find the event',
    });
  }
  if (!organizer.canReceivePayouts) {
    items.push({
      key: 'payouts',
      icon: 'bank',
      tone: 'warning',
      text: organizer.stripeConnected ? 'Stripe still needs some details before you can be paid.' : 'Connect a payout account to sell online.',
      href: '/organizer/payouts',
      cta: organizer.stripeConnected ? 'Finish' : 'Set up',
    });
  }
  if (rejected > 0) {
    items.push({
      key: 'rejected', icon: 'info', tone: 'warning',
      text: `${rejected} ${rejected === 1 ? 'event needs' : 'events need'} changes before review.`,
      href: '/organizer/events?status=rejected', cta: 'Review',
    });
  }
  if (draft > 0) {
    items.push({
      key: 'draft', icon: 'calendar', tone: 'neutral',
      text: `${draft} ${draft === 1 ? 'draft is' : 'drafts are'} not submitted yet.`,
      href: '/organizer/events?status=draft', cta: 'Open',
    });
  }

  return (
    <Panel title="Needs you" description={items.length ? `${items.length} ${items.length === 1 ? 'thing' : 'things'} to do` : null}>
      {items.length === 0 ? (
        <p className="fx-row text-sm text-muted">
          <span className="text-accent"><NavIcon name="check" size={18} /></span>
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="es-deflist">
          {items.map((item) => (
            <li key={item.key} className="es-deflist__row items-center">
              <span className="fx-row fx-min0 flex-1 flex-nowrap items-start text-sm text-ink">
                <span className="es-status mt-0.5 px-1.5" data-tone={item.tone}>
                  <span className="sr-only">{item.tone === 'danger' ? 'Urgent' : 'To do'}</span>
                </span>
                <span className="fx-min0 flex-1">{item.text}</span>
              </span>
              <Link href={item.href} className="es-btn es-btn--secondary es-btn--sm">{item.cta}</Link>
            </li>
          ))}
        </ul>
      )}
      {pendingReview > 0 && (
        <p className="text-xs text-subtle">
          {pendingReview} {pendingReview === 1 ? 'event is' : 'events are'} with Eventsli for review.
        </p>
      )}
    </Panel>
  );
}

export function Upcoming({ events }) {
  return (
    <Panel
      title="Coming up"
      action={<Link href="/organizer/events?status=published" className="text-sm text-accent hover:text-accent-hover">All on sale</Link>}
    >
      {!events?.length ? (
        <p className="text-sm text-muted">Nothing on sale is coming up. Published events appear here.</p>
      ) : (
        <ul className="es-deflist">
          {events.map((event) => (
            <li key={event.id} className="es-deflist__row">
              <Link href={`/organizer/events/${event.id}`} className="fx-row fx-row--between group w-full flex-nowrap">
                <span className="fx-min0 flex-1">
                  <span className="fx-truncate block font-medium text-ink group-hover:text-accent">{event.title}</span>
                  <span className="block text-sm text-muted">
                    {formatEventTime(event.startsAt, event.timezone)}
                    {event.venue && ` · ${event.venue}`}
                  </span>
                </span>
                <span className="es-nums whitespace-nowrap text-sm text-muted">
                  <span className="text-ink">{event.ticketsSold}</span> sold
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RecentOrders({ orders }) {
  return (
    <Panel title="Latest orders">
      {!orders?.length ? (
        <p className="text-sm text-muted">No orders yet. They appear here the moment a ticket sells.</p>
      ) : (
        <ul className="es-deflist">
          {orders.map((order) => (
            <li key={order.id} className="es-deflist__row">
              <Link href={`/organizer/events/${order.eventId}/orders`} className="fx-row fx-row--between group w-full flex-nowrap">
                <span className="fx-min0 flex-1">
                  <span className="fx-truncate block font-medium text-ink group-hover:text-accent">
                    {order.buyerName || order.buyerEmail || 'A buyer'}
                  </span>
                  <span className="fx-truncate block text-sm text-muted">
                    {order.tickets} × {order.eventTitle}
                    {order.channel === 'manual' && ' · at the door'}
                  </span>
                </span>
                <span className="es-nums whitespace-nowrap text-sm text-ink">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
