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
import EventActions from './EventActions';
import BuildNav from './BuildNav';
import { BuildStepProvider } from './BuildStep';

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
      // An action's answer is the event without the side data only `GET` adds
      // (the cancellation request); keep that until the re-read replaces it.
      setState((s) => ({ event: { cancellationRequest: s.event?.cancellationRequest ?? null, ...next }, error: null }));
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
        <ErrorNotice error={state.error} onRetry={refresh} action={{ href: '/organizer/events', label: 'Back to your events' }} />
      </div>
    );
  }

  return (
    <EventProvider value={value}>
      {/* Wraps the screen AND the bar, because the point of it is to carry a
          save from the first to the second. See BuildStep.jsx. */}
      <BuildStepProvider>
        <div className="fx-stack">
          <EventHeader event={state.event} eventId={id} onChanged={refresh} />
          {children}
          {/* Once, here, rather than in each of the nine build pages — every one
              of them would have to remember, and the one that forgot would be
              the dead end this exists to remove. `BuildNav` renders nothing on
              the screens that are not steps. */}
          <BuildNav />
        </div>
      </BuildStepProvider>
    </EventProvider>
  );
}

function EventHeader({ event, eventId, onChanged }) {
  const pathname = usePathname() || '';
  const listingType = event?.listingType || null;
  // A general-admission event has no seat map, so the strip does not offer one.
  const admissionType = event?.admissionType || null;
  const sections = useMemo(() => {
    const groups = organizerNavGroups({ eventId, listingType, admissionType }).filter((g) => ['build', 'sell', 'day'].includes(g.id));
    return resolveNav(groups, pathname).flatMap((g) => g.items);
  }, [eventId, listingType, admissionType, pathname]);

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
            {event.listingType === 'display_only' ? (
              <span className="es-meta__item"><NavIcon name="eye" size={16} />Display only</span>
            ) : (
              <span className="es-meta__item"><NavIcon name="ticket" size={16} />Ticketed · {event.currency}</span>
            )}
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

      {/* The event's own actions live on its overview. On Ticket types or Orders
          they were four more buttons between the title and the work, and on a
          phone they pushed the section itself below the fold. */}
      {pathname === `/organizer/events/${eventId}` && <EventActions event={event} onChanged={onChanged} />}

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
