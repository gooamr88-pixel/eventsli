'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatEventTime } from '../../lib/eventTime';
import NavIcon from '../../components/shell/NavIcon';
import MoreActions, { MoreItem } from '../../components/ui/MoreActions';
import { whenOf, eventLook } from '../events/eventLook';
import { useNowMinute } from '../../hooks/useNowMinute';

/**
 * Your events, split by WHEN rather than by status: a draft dated next month
 * is upcoming, and its status pill says it is a draft. All = the other three.
 */
const ROWS = 3;

/** Ongoing first, then the soonest upcoming, then the most recent past. */
function order(events, now) {
  const rank = { ongoing: 0, upcoming: 1, past: 2 };
  return [...events].sort((a, b) => {
    const wa = whenOf(a, now);
    const wb = whenOf(b, now);
    if (wa !== wb) return rank[wa] - rank[wb];
    const da = Date.parse(a.startsAt);
    const db = Date.parse(b.startsAt);
    return wa === 'past' ? db - da : da - db;
  });
}

export default function YourEvents({ events }) {
  const now = useNowMinute();
  const [tab, setTab] = useState('all');
  const list = events || [];
  const counts = { all: list.length, upcoming: 0, ongoing: 0, past: 0 };
  if (now !== null) for (const e of list) counts[whenOf(e, now)] += 1;

  const tabs = [
    ['all', 'All'], ['upcoming', 'Upcoming'], ['ongoing', 'Ongoing'], ['past', 'Past'],
  ];
  const shown = now === null
    ? list.slice(0, ROWS)
    : order(list.filter((e) => tab === 'all' || whenOf(e, now) === tab), now).slice(0, ROWS);

  return (
    <section className="es-dcard" aria-labelledby="dash-events">
      <div className="es-dcard__head">
        <h2 id="dash-events" className="es-dcard__title">Your Events</h2>
        <Link href="/organizer/events" className="es-dcard__link">
          View All <NavIcon name="arrow" size={16} />
        </Link>
      </div>

      <div className="es-evtabs" role="tablist" aria-label="Which events">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className="es-evtabs__tab"
            onClick={() => setTab(key)}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="es-dcard__empty">
          {list.length === 0 ? 'No events yet. Create one and it appears here.' : `No ${tab} events.`}
        </p>
      ) : (
        <ul className="es-evrows" role="tabpanel">
          {shown.map((event) => <EventRow key={event.id} event={event} now={now} />)}
        </ul>
      )}
    </section>
  );
}

/** One event as a row — here, and as the list view of the Your events page. */
export function EventRow({ event, now }) {
  const [label, tone, icon] = eventLook(event, now);
  const place = event.city || event.venue;
  const fill = event.capacity && event.sold !== null && event.sold !== undefined ? Math.min(100, Math.round((event.sold / event.capacity) * 100)) : null;
  const href = `/organizer/events/${event.id}`;

  return (
    <li className="es-evrow">
      <Link href={href} className="es-evrow__main">
        <span className="es-evrow__thumb">
          {event.coverUrl
            // Organizer-uploaded covers on our storage; a plain img keeps the
            // row free of image-optimizer config for a 90px thumbnail.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={event.coverUrl} alt="" loading="lazy" />
            : <NavIcon name="image" size={22} />}
        </span>
        <span className="fx-min0">
          <span className="es-evrow__title fx-truncate">{event.title}</span>
          <span className="es-evrow__date">
            <NavIcon name="calendar" size={14} />
            {formatEventTime(event.startsAt, event.timezone, { time: false })}
          </span>
        </span>
      </Link>
      <span className="es-evrow__place">
        {place && (<><NavIcon name="pin" size={16} /><span className="fx-truncate">{place}</span></>)}
      </span>
      <span className="es-evrow__status">
        <span className="es-evpill" data-tone={tone}><NavIcon name={icon} size={14} />{label}</span>
      </span>
      <span className="es-evrow__cap">
        <span className="es-evrow__count">
          <NavIcon name="users" size={16} />
          {event.sold === null || event.sold === undefined
            ? '—'
            : `${event.sold.toLocaleString()}${event.capacity ? ` / ${event.capacity.toLocaleString()}` : ' sold'}`}
        </span>
        {fill !== null && (
          <span className="es-evrow__bar" role="img" aria-label={`${fill}% of capacity sold`}>
            <span style={{ width: `${fill}%` }} />
          </span>
        )}
      </span>
      <span className="es-evrow__more">
        <MoreActions compact align="end" srLabel={`Actions for ${event.title}`}>
          <MoreItem href={href} icon="settings">Manage event</MoreItem>
          <MoreItem href={`/organizer/events/${event.id}/orders`} icon="receipt">Orders</MoreItem>
          <MoreItem href={`/organizer/events/${event.id}/share`} icon="send">Share &amp; invite</MoreItem>
          {event.status === 'published' && <MoreItem href={`/e/${event.slug}`} icon="external">View public page</MoreItem>}
        </MoreActions>
      </span>
    </li>
  );
}
