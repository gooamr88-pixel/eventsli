'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { get } from '../../../utils/apiClient';
import StatusPill from '../../StatusPill';
import NavIcon from '../../../components/shell/NavIcon';
import { ErrorNotice } from '../../../components/Feedback';
import { EventProvider } from './EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event's frame: which event this is, where it stands, and the way to its
 * public page. The tab strip that used to live here is gone — the sidebar owns
 * navigation now, and every route it pointed at is unchanged.
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
        if (!cancelled) setState({ event: null, error });
      }
    })();
    return () => { cancelled = true; };
  }, [id, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
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
        <EventHeader event={state.event} />
        {children}
      </div>
    </EventProvider>
  );
}

function EventHeader({ event }) {
  if (!event) {
    return (
      <div className="fx-stack fx-stack--sm" aria-hidden="true">
        <span className="es-skeleton es-skeleton--line w-24" />
        <span className="es-skeleton h-8 w-2/3" />
      </div>
    );
  }

  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone,
  }).format(new Date(event.startsAt));

  return (
    <header className="fx-stack fx-stack--sm border-b border-border-base pb-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/organizer/events" className="hover:text-ink">Your events</Link>
        <span aria-hidden> / </span>
        <span className="text-ink">{event.title}</span>
      </nav>
      <div className="fx-row fx-row--between">
        <div className="fx-stack fx-stack--sm gap-1 fx-min0">
          <h1 className="fx-break text-2xl text-ink">{event.title}</h1>
          <p className="text-sm text-muted">
            {when}
            {event.venue?.name && ` · ${event.venue.name}`}
          </p>
        </div>
        <div className="fx-row">
          <StatusPill status={event.status} />
          {event.status === 'published' && (
            <a
              href={`/e/${event.slug}`}
              target="_blank"
              rel="noreferrer"
              className="es-btn es-btn--secondary es-btn--sm"
            >
              <NavIcon name="globe" size={16} />
              Public page
            </a>
          )}
          <Link href={`/organizer/events/${event.id}/share`} className="es-btn es-btn--secondary es-btn--sm">
            <NavIcon name="qr" size={16} />
            Share
          </Link>
        </div>
      </div>
    </header>
  );
}
