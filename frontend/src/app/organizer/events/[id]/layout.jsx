'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { get } from '../../../utils/apiClient';
import { formatEventTime } from '../../../lib/eventTime';
import StatusPill from '../../StatusPill';
import NavIcon from '../../../components/shell/NavIcon';
import { resolveNav } from '../../../components/shell/navModel';
import { ErrorNotice } from '../../../components/Feedback';
import { organizerNavGroups } from '../../nav/organizerNav';
import { EventProvider } from './EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event's frame: which event this is, where it stands, and the way to its
 * public page.
 *
 * On a desktop the sidebar owns navigation. Below `lg` it is a drawer, and
 * reaching "Ticket types" from an event meant opening the menu every time — so
 * the same destinations, from the same nav model, sit under the header as a
 * scrolling strip there, and nowhere else.
 *
 * `refresh(next)` takes the server's updated event when an action returned one
 * (accepting the terms, submitting). The page moves on from that answer at once
 * and the re-read confirms it — rather than repainting the stale event for a
 * round trip, which is exactly what made accepting the terms look like a no-op.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventLayout({ children }) {
  const { id } = useParams();
  const [state, setState] = useState({ event: null, error: null });
  const [version, setVersion] = useState(0);

  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    setState({ event: null, error: null });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const event = await get(`/events/${id}`, { cache: 'no-store' });
        if (!cancelled) setState({ event, error: null });
      } catch (error) {
        if (!cancelled) setState((s) => (s.event ? s : { event: null, error }));
      }
    })();
    return () => { cancelled = true; };
  }, [id, version]);

  const refresh = useCallback((next) => {
    if (next && typeof next === 'object' && next.id === id && next.review) {
      setState({ event: next, error: null });
    }
    setVersion((v) => v + 1);
  }, [id]);

  const value = useMemo(
    () => ({ eventId: id, event: state.event, error: state.error, refresh }),
    [id, state, refresh],
  );

  if (state.error) {
    return (
      <div className="fx-stack">
        <ErrorNotice error={state.error} action={{ href: '/organizer/events', label: 'Back to your events' }} />
      </div>
    );
  }

  return (
    <EventProvider value={value}>
      <div className="fx-stack">
        <EventHeader event={state.event} eventId={id} />
        {children}
      </div>
    </EventProvider>
  );
}

function EventHeader({ event, eventId }) {
  const pathname = usePathname() || '';
  const sections = useMemo(() => {
    const groups = organizerNavGroups({ eventId }).filter((g) => ['build', 'sell', 'day'].includes(g.id));
    return resolveNav(groups, pathname).flatMap((g) => g.items);
  }, [eventId, pathname]);

  if (!event) {
    return (
      <div className="es-event-head" aria-hidden="true">
        <span className="es-skeleton es-skeleton--line w-24" />
        <span className="es-skeleton h-9 w-2/3" />
        <span className="es-skeleton es-skeleton--line w-1/3" />
      </div>
    );
  }

  const when = formatEventTime(event.startsAt, event.timezone);

  return (
    <header className="es-event-head">
      <nav aria-label="Breadcrumb" className="es-breadcrumb">
        <Link href="/organizer/events">Your events</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="fx-truncate">{event.title}</span>
      </nav>

      <div className="es-event-head__main">
        <div className="fx-stack fx-stack--sm fx-min0 gap-2">
          <h1 className="es-page-head__title fx-break">{event.title}</h1>
          <p className="es-meta">
            <span className="es-meta__item"><NavIcon name="calendar" size={16} />{when}</span>
            {event.venue?.name && (
              <span className="es-meta__item"><NavIcon name="pin" size={16} />{event.venue.name}</span>
            )}
            <span className="es-meta__item"><NavIcon name="money" size={16} />{event.currency}</span>
          </p>
        </div>
        <div className="es-event-head__actions">
          <StatusPill status={event.status} />
          {event.status === 'published' && (
            <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary es-btn--sm">
              <NavIcon name="external" size={16} />
              Public page<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <Link href={`/organizer/events/${event.id}/share`} className="es-btn es-btn--secondary es-btn--sm">
            <NavIcon name="qr" size={16} />
            Share
          </Link>
        </div>
      </div>

      <nav aria-label="Event sections" className="es-subnav">
        {sections.map((item) => (
          <Link key={item.key} href={item.href} className="es-subnav__link" aria-current={item.active ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
