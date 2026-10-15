'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { get } from '../../../utils/apiClient';
import { formatEventTime } from '../../../lib/eventTime';
import StatusPill from '../../StatusPill';
import NavIcon from '../../../components/shell/NavIcon';
import { ErrorNotice } from '../../../components/Feedback';
import { EventProvider } from './EventContext';
import EventActions from './EventActions';
import BuildNav, { BuildProgress } from './BuildNav';
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
  const onOverview = pathname === `/organizer/events/${eventId}`;

  return (
    /**
     * ─────────────────────────────────────────────────────────────────────────
     * COMPACT ON A SECTION, BELOW `md` — `.es-event-head--sub`.
     *
     * This header is the overview's, and it rendered in full above every one
     * of the eleven sections: breadcrumb, a title of three or four lines, the
     * date, venue and type, and Public page / Share. On a 320×568 phone that
     * put the Orders heading 487px down, under the fold — every section opened
     * on a screen of navigation. The app bar names the event and the section
     * now, so on a phone a section keeps the way back, the title on one line
     * and the status, and the facts stay on the overview where they are read.
     * Tablets and desktops are unchanged.
     * ─────────────────────────────────────────────────────────────────────────
     */
    <header className={`es-event-head ${onOverview ? '' : 'es-event-head--sub'}`}>
      <nav aria-label="Breadcrumb" className="es-breadcrumb">
        {/* `fx-touch`: this is the way back up, and it was a 76×21 target. */}
        <Link href="/organizer/events" className="es-breadcrumb__up fx-touch">
          <span aria-hidden className="es-breadcrumb__back"><NavIcon name="arrow" size={16} /></span>
          Your events
        </Link>
        <span aria-hidden="true" className="es-breadcrumb__sep">/</span>
        <span aria-current="page" className="es-breadcrumb__here fx-truncate">{event.title}</span>
      </nav>

      <div className="es-event-head__main">
        <div className="fx-stack fx-stack--sm fx-min0 gap-2">
          <h1 className="es-page-head__title fx-break">{event.title}</h1>
          <p className="es-meta">
            {/* THE STATUS IS A FACT, SO IT SITS WITH THE OTHER FACTS.
                It used to be the first thing in the actions row, which put
                "Archived" — a read-only badge — in a line of buttons, where it
                read as one and was tapped like one. Beside the date, the venue
                and the currency it reads as what it is: something true about
                this event. */}
            <StatusPill status={event.status} />
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
        <div className="es-event-head__actions" role="group" aria-label="Event actions">
          {/* The event's own actions live on its overview, in this one row with
              Public page and Share — see EventActions. On Ticket types or Orders
              they were four more buttons between the title and the work. */}
          {onOverview ? (
            <EventActions event={event} onChanged={onChanged}>
              <HeaderLinks event={event} />
            </EventActions>
          ) : (
            <HeaderLinks event={event} />
          )}
        </div>
      </div>

      {/* "Setup · step 3 of 6" on a build screen before launch. Renders nothing
          anywhere else. */}
      {!onOverview && <BuildProgress />}

      {/**
        * ─────────────────────────────────────────────────────────────────────
        * THE SECTION TABS ARE GONE, and they were the third row of navigation.
        *
        * A scrolling strip of every event section used to sit here, built from
        * the same nav model the sidebar renders. It existed because below `lg`
        * the sidebar is a drawer, so it was a shortcut past the menu.
        *
        * What it actually produced on a phone was: the app bar, then the
        * "Working on" bar, then this strip — three bands of chrome, each a
        * different shape, before a single word of the page. And because it was
        * horizontally scrollable, the sections past "Seating" were behind a
        * sideways swipe nothing indicated: the tab list said there were four
        * sections when there are eleven.
        *
        * Every section is a page of its own, reached from one place. The
        * sidebar names all of them, vertically, with icons, and lights the one
        * you are on — which is the thing this strip was a worse copy of. On a
        * phone the bottom bar carries the three opened most and "More" opens
        * the same list.
        * ─────────────────────────────────────────────────────────────────────
        */}
    </header>
  );
}

/** Public page (once it is on sale) and Share — the two links every section's header offers. */
function HeaderLinks({ event }) {
  return (
    <>
      <Link href={`/organizer/events/${event.id}/share`} className="es-btn es-btn--secondary es-btn--sm">
        <NavIcon name="qr" size={16} />
        Share
      </Link>
      {event.status === 'published' && (
        <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="external" size={16} />
          Public page<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </>
  );
}
