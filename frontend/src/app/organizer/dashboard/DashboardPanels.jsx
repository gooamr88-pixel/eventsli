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
 * The first screen for an organizer with no events, once the organization is
 * set up: where they are on the road to a first event, and ONE button for the
 * step they are on. Each step's button leads to the next — nobody has to work
 * out what to do now.
 *
 * Payments can be skipped: an organizer who only lists events never needs them,
 * and a ticketed draft can be built before they exist (it just cannot go on sale).
 */
export function GettingStarted({ organizer }) {
  const paymentsReady = (organizer.payments?.choices?.length ?? 0) > 0;
  const steps = [
    {
      key: 'organization', state: 'done', title: 'Your organization',
      detail: `Buyers see you as ${organizer.displayName}.`,
    },
    {
      key: 'payments',
      state: paymentsReady ? 'done' : 'current',
      title: 'Payment methods',
      detail: paymentsReady
        ? describeChoices(organizer)
        : 'Connect Stripe for cards, add e-Transfer or cash, or both. Not needed for display-only events.',
    },
    {
      key: 'event',
      state: paymentsReady ? 'current' : 'upcoming',
      title: 'Create your first event',
      detail: 'Choose a ticketed event or a display-only listing. It stays a private draft until you submit it.',
    },
  ];

  return (
    <section className="es-onboard es-band--field" aria-labelledby="onboard-title">
      <div className="fx-stack fx-stack--sm gap-4">
        <p className="es-eyebrow">Welcome, {organizer.displayName}</p>
        <h2 id="onboard-title" className="max-w-[20ch] text-ink">
          {paymentsReady ? 'Now create your first event.' : 'Next: how buyers pay you.'}
        </h2>
        <p className="max-w-[46ch] text-muted">
          {paymentsReady
            ? 'Everything saves as you go, and nothing is public until Eventsli approves it.'
            : 'Set up at least one payment method so your ticketed events can go on sale.'}
        </p>
        <div className="fx-row gap-2">
          {paymentsReady ? (
            <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg">
              <NavIcon name="plus" size={18} />
              Create your first event
            </Link>
          ) : (
            <>
              <Link href="/organizer/payments?onboarding=1" className="es-btn es-btn--primary es-btn--lg">
                <NavIcon name="card" size={18} />
                Set up payment methods
              </Link>
              <Link href="/organizer/events/new" className="es-btn es-btn--ghost">
                Skip for now
              </Link>
            </>
          )}
        </div>
      </div>

      <ol className="es-steps rounded-(--es-radius-lg) bg-bg-sunken p-5" aria-label="Getting set up">
        {steps.map((step, i) => (
          <li key={step.key} className="es-steps__item" data-state={step.state}>
            <span className="es-steps__marker" aria-hidden="true">
              {step.state === 'done' ? <NavIcon name="tick" size={16} /> : i + 1}
            </span>
            <div className="es-steps__body">
              <p className="es-steps__title">
                {step.title}
                {step.state === 'done' && <span className="sr-only"> — done</span>}
                {step.state === 'current' && <span className="sr-only"> — you are here</span>}
              </p>
              <p className="text-sm text-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function describeChoices(organizer) {
  const { stripeReady, manualMethods } = organizer.payments || {};
  if (stripeReady && manualMethods > 0) return 'Stripe and manual payments are ready.';
  if (stripeReady) return 'Stripe is connected for card payments.';
  return `${manualMethods} manual payment ${manualMethods === 1 ? 'method is' : 'methods are'} ready.`;
}

/**
 * "What needs you." Each line is a count with the place to deal with it —
 * a number with nowhere to go is a worry, not a task. The payout account is the
 * first line when it is missing; the dashboard shows it nowhere else.
 *
 * In review is listed but not as a task: that one is waiting on Eventsli.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DRAFTS AND SENT-BACK EVENTS ARE NOT LISTED HERE ANY MORE.
 *
 * They were, as two counted lines — "3 drafts are not submitted yet · Open" and
 * "1 event needs changes before review · Review". The Drafts panel directly
 * below now lists those same events by name, with how far each one got, what it
 * is waiting on, and a button that opens that exact step. Keeping the counts as
 * well meant the same fact stated twice, a few hundred pixels apart, once
 * vaguely and once usefully — and an organizer counting four things to do when
 * there were two.
 *
 * What stays here is everything Drafts cannot show: money owed, and an account
 * that cannot take payment.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function Attention({ data, organizer }) {
  const items = [];
  const { pendingReview = 0 } = data.events || {};
  const overdue = data.invoices?.overdue || 0;

  if (overdue > 0) {
    items.push({
      key: 'overdue',
      tone: 'danger',
      text: `${overdue} commission ${overdue === 1 ? 'invoice is' : 'invoices are'} overdue — scanning is off for ${overdue === 1 ? 'that event' : 'those events'}.`,
      href: '/organizer/events?status=published',
      cta: 'Find the event',
    });
  }
  if ((organizer.payments?.choices?.length ?? 0) === 0) {
    items.push({
      key: 'payments',
      tone: 'warning',
      text: organizer.stripeConnected
        ? 'Stripe still needs some details, and there is no manual payment method.'
        : 'Add a payment method so ticketed events can go on sale.',
      href: '/organizer/payments',
      cta: 'Set up',
    });
  }

  // Nothing owed, nothing broken and nothing in the queue: the panel would be a
  // card saying so, above a Drafts panel listing three unfinished events — which
  // reads as a contradiction. The page says enough without it.
  if (items.length === 0 && pendingReview === 0) return null;

  return (
    <Panel title="Needs you" description={items.length ? `${items.length} ${items.length === 1 ? 'thing' : 'things'} to do` : null}>
      {items.length === 0 ? (
        <p className="fx-row text-sm text-muted">
          <span className="text-accent"><NavIcon name="check" size={18} /></span>
          Nothing to settle, and your account can take payments.
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
