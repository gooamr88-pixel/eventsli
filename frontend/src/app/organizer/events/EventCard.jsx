import Link from 'next/link';
import { formatMoneyCompact } from '../../utils/money';
import NavIcon from '../../components/shell/NavIcon';
import MoreActions, { MoreItem } from '../../components/ui/MoreActions';
import { eventLook, whenOf, dateRange } from './eventLook';

/**
 * One event as a card: its cover with where it stands, when and where, the
 * three figures that say how it is doing, and the four things done to it most.
 *
 * The action row follows the event's life. A draft's last button is Publish —
 * the overview, where the launch checklist and the submit button live; a past
 * event's is its report (the orders, which export). The public-page button is
 * only there when there is a public page.
 */
export default function EventCard({ event, now }) {
  const [label, tone, icon] = eventLook(event, now);
  const base = `/organizer/events/${event.id}`;
  const live = event.status === 'published';
  const isDraft = event.status === 'draft';
  const isPast = event.status === 'completed' || (live && now !== null && whenOf(event, now) === 'past');
  const place = event.city || event.venue;
  const known = (v) => v !== null && v !== undefined;

  return (
    <li className="es-ocard">
      <div className="es-ocard__media">
        {event.coverUrl
          // Organizer-uploaded covers on our own storage; a plain img keeps the
          // card free of image-optimizer configuration.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={event.coverUrl} alt="" loading="lazy" />
          : <span className="es-ocard__placeholder"><NavIcon name="image" size={32} /></span>}
        <span className="es-evpill es-ocard__pill" data-tone={tone}><NavIcon name={icon} size={14} />{label}</span>
        <span className="es-ocard__more">
          <MoreActions compact align="end" srLabel={`More for ${event.title}`} triggerClassName="es-ocard__kebab" trigger={<NavIcon name="kebab" size={20} />}>
            <MoreItem href={base} icon="settings">Manage event</MoreItem>
            <MoreItem href={`${base}/orders`} icon="receipt">Orders</MoreItem>
            <MoreItem href={`${base}/attendees`} icon="users">Attendees</MoreItem>
            <MoreItem href={`${base}/tiers`} icon="ticket">Ticket types</MoreItem>
            {live && <MoreItem href={`/e/${event.slug}`} icon="external">View public page</MoreItem>}
          </MoreActions>
        </span>
      </div>

      <div className="es-ocard__body">
        <h3 className="es-ocard__title fx-truncate"><Link href={base}>{event.title}</Link></h3>
        <p className="es-ocard__meta">
          <span><NavIcon name="calendar" size={16} />{dateRange(event)}</span>
          {place && <span className="fx-min0"><NavIcon name="pin" size={16} /><span className="fx-truncate">{place}</span></span>}
        </p>

        <div className="es-ocard__stats">
          <Stat icon="users" label="Attendees" value={known(event.sold) ? event.sold.toLocaleString() : '—'} />
          <Stat icon="ticket" label="Tickets" value={known(event.capacity) ? event.capacity.toLocaleString() : '—'} />
          <Stat
            icon="coins"
            label="Revenue"
            value={known(event.grossCents) && event.grossCents > 0 ? formatMoneyCompact(event.grossCents, event.currency || 'USD') : '—'}
          />
        </div>

        <div className="es-ocard__actions">
          <Link href={base} className="es-btn es-btn--secondary es-btn--sm"><NavIcon name="chart" size={16} />Analytics</Link>
          {isPast ? (
            <Link href={`${base}/orders`} className="es-btn es-btn--secondary es-btn--sm es-ocard__wide"><NavIcon name="fileText" size={16} />View Report</Link>
          ) : (
            <>
              <Link href={`${base}/details`} className="es-btn es-btn--secondary es-btn--sm"><NavIcon name="pencil" size={16} />Edit</Link>
              <Link href={`${base}/share`} className="es-btn es-btn--secondary es-btn--sm"><NavIcon name="share" size={16} />Share</Link>
            </>
          )}
          {isDraft ? (
            <Link href={base} className="es-btn es-btn--primary es-btn--sm"><NavIcon name="send" size={16} />Publish</Link>
          ) : live ? (
            <a href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer" className="es-btn es-btn--secondary es-btn--sm es-ocard__icon">
              <NavIcon name="external" size={16} />
              <span className="sr-only">Open the public page (new tab)</span>
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Stat({ icon, label, value }) {
  return (
    <span className="es-ocard__stat">
      <NavIcon name={icon} size={18} />
      <span className="fx-min0">
        <b className="fx-truncate">{value}</b>
        <small>{label}</small>
      </span>
    </span>
  );
}
