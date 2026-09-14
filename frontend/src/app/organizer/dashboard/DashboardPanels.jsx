import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { Panel } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The dashboard's three lists. Each is empty-safe and says what an empty list
 * MEANS rather than showing a blank card.
 */

/**
 * "What needs you." Each line is a count with the place to deal with it —
 * a number with nowhere to go is a worry, not a task.
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
      icon: 'percent',
      text: `${overdue} commission ${overdue === 1 ? 'invoice is' : 'invoices are'} overdue — scanning is off for ${overdue === 1 ? 'that event' : 'those events'}.`,
      href: '/organizer/events',
      cta: 'Find the event',
    });
  }
  if (!organizer.canReceivePayouts) {
    items.push({ key: 'payouts', icon: 'bank', text: 'Connect a payout account to sell online.', href: '/organizer/payouts', cta: 'Set up' });
  }
  if (rejected > 0) {
    items.push({
      key: 'rejected', icon: 'info',
      text: `${rejected} ${rejected === 1 ? 'event needs' : 'events need'} changes before review.`,
      href: '/organizer/events?status=rejected', cta: 'Review',
    });
  }
  if (draft > 0) {
    items.push({
      key: 'draft', icon: 'calendar',
      text: `${draft} ${draft === 1 ? 'draft is' : 'drafts are'} not submitted yet.`,
      href: '/organizer/events?status=draft', cta: 'Open',
    });
  }

  return (
    <Panel title="Needs you">
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing right now.</p>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {items.map((item) => (
            <li key={item.key} className="fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0">
              <span className="fx-row fx-min0 flex-1 text-sm text-ink">
                <span className="text-accent"><NavIcon name={item.icon} size={18} /></span>
                <span className="fx-min0 flex-1">{item.text}</span>
              </span>
              <Link href={item.href} className="text-sm text-accent hover:text-accent-hover">{item.cta}</Link>
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
      action={<Link href="/organizer/events?status=published" className="text-sm text-accent">All on sale</Link>}
    >
      {!events?.length ? (
        <p className="text-sm text-muted">Nothing on sale is coming up. Published events appear here.</p>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {events.map((event) => (
            <li key={event.id} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
              <Link href={`/organizer/events/${event.id}`} className="fx-row fx-row--between group">
                <span className="fx-min0 flex-1">
                  <span className="fx-truncate block text-ink group-hover:text-accent">{event.title}</span>
                  <span className="block text-sm text-muted">
                    {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone,
                    }).format(new Date(event.startsAt))}
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
        <ul className="fx-stack fx-stack--sm">
          {orders.map((order) => (
            <li key={order.id} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
              <Link href={`/organizer/events/${order.eventId}/orders`} className="fx-row fx-row--between group">
                <span className="fx-min0 flex-1">
                  <span className="fx-truncate block text-ink group-hover:text-accent">
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
