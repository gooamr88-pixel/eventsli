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
import BuildNav, { BuildProgress } from './BuildNav';
import { organizerNavGroups } from '../../nav/organizerNav';
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
          <EventHeader event={state.event} eventId={id} />
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

/** The sections that open on the cover card, and what their head says. */
const PAGE_HEADS = {
  '': { title: 'Overview', lede: 'A quick summary of your event, its performance, and setup progress.' },
  details: { title: 'Event details', lede: 'Manage your event’s core information, description, and settings.' },
  content: {
    title: 'Page & branding',
    lede: 'Customize how your event looks and feels on the public page.',
    aside: true,
  },
};

function EventHeader({ event, eventId }) {
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

  // THE OVERVIEW AND EVENT DETAILS HAVE THEIR OWN HEAD: the way back and the
  // page's name. The title, the facts and the actions are in the cover card
  // right under it (EventHero), so repeating them here would say everything
  // twice. Every other section gets the breadcrumb head below.
  const section = pathname.slice(`/organizer/events/${eventId}`.length).replace(/^\//, '');
  const head = PAGE_HEADS[section];
  if (head) {
    const base = `/organizer/events/${eventId}`;
    return (
      <header className="es-ovhead">
        <nav aria-label="Breadcrumb" className="es-ovhead__crumbs">
          <Link href="/organizer/events" className="es-ovhead__back fx-touch">
            <span aria-hidden="true" className="es-ovhead__arrow"><NavIcon name="arrow" size={18} /></span>
            Your events
          </Link>
          <span aria-hidden="true"><NavIcon name="chevronDown" size={14} className="-rotate-90" /></span>
          {section ? (
            <>
              <Link href={base} className="es-ovhead__back es-ovhead__mid fx-truncate">{event.title}</Link>
              <span aria-hidden="true"><NavIcon name="chevronDown" size={14} className="-rotate-90" /></span>
              <span aria-current="page" className="es-ovhead__here es-ovhead__here--accent">{head.title}</span>
            </>
          ) : (
            <span aria-current="page" className="es-ovhead__here fx-truncate">{event.title}</span>
          )}
        </nav>
        <div className="es-ovhead__row">
          <div className="fx-min0">
            <h1 className="es-ovhead__title">{head.title}</h1>
            <p className="es-ovhead__lede">{head.lede}</p>
          </div>
          {/* Where it stands and the way to see it, for the screen that builds
              the public page. The link only once there IS a public page. */}
          {head.aside && (
            <div className="es-ovhead__aside">
              <StatusPill status={event.status} />
              <span className="es-ovhead__event fx-truncate">{event.title}</span>
              {event.status === 'published' && (
                <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary">
                  <NavIcon name="external" size={18} />Preview page<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
          )}
        </div>
        {/* "Setup · step 2 of 6" on a build screen before launch; nothing on the overview. */}
        {section && <BuildProgress />}
      </header>
    );
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * EVERY OTHER SECTION: the breadcrumb, then the event at a glance — cover,
   * name, status, date and venue. The section's own name is the page's <h1>,
   * in its SectionHeader right under this.
   *
   * KEPT SHORT ON A PHONE: the old header here stacked the title, date, venue
   * and currency and put the Orders heading 487px down a 320×568 screen. The
   * row below is one line of thumbnail, name and status there — the date and
   * venue appear from `sm` (see `.es-evident__fact`).
   * ─────────────────────────────────────────────────────────────────────────
   */
  const base = `/organizer/events/${eventId}`;
  const here = sectionLabel(eventId, pathname);
  return (
    <header className="es-ovhead es-ovhead--section">
      <nav aria-label="Breadcrumb" className="es-ovhead__crumbs">
        <Link href="/organizer/events" className="es-ovhead__back fx-touch">
          <span aria-hidden="true" className="es-ovhead__arrow"><NavIcon name="arrow" size={18} /></span>
          Your events
        </Link>
        <span aria-hidden="true"><NavIcon name="chevronDown" size={14} className="-rotate-90" /></span>
        <Link href={base} className="es-ovhead__back es-ovhead__mid fx-truncate">{event.title}</Link>
        {here && (
          <>
            <span aria-hidden="true"><NavIcon name="chevronDown" size={14} className="-rotate-90" /></span>
            <span aria-current="page" className="es-ovhead__here es-ovhead__here--accent">{here}</span>
          </>
        )}
      </nav>
      {/* WHICH EVENT, AT A GLANCE: its cover, its name, where it stands, when
          and where. Not a heading — the section's own title is the page's
          <h1>, right under this. The links to the public page and Share live
          on the overview and in the sidebar. */}
      <div className="es-evident">
        <Link href={base} className="es-evident__thumb" tabIndex={-1} aria-hidden="true">
          {event.cover?.url
            // The organizer's own cover, from our storage.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={event.cover.url} alt="" />
            : <NavIcon name="image" size={22} />}
        </Link>
        <div className="fx-min0">
          <p className="es-evident__title fx-truncate">{event.title}</p>
          <p className="es-evident__meta">
            <StatusPill status={event.status} />
            <span className="es-evident__fact"><NavIcon name="calendar" size={16} />{formatEventTime(event.startsAt, event.timezone)}</span>
            {event.venue?.name && <span className="es-evident__fact"><NavIcon name="pin" size={16} />{event.venue.name}</span>}
          </p>
        </div>
      </div>
      {/* "Setup · step 3 of 6" on a build screen before launch. Renders nothing
          anywhere else. */}
      <BuildProgress />
    </header>
  );
}

/** The sidebar's name for the section this URL is in, from the same nav model. */
function sectionLabel(eventId, pathname) {
  const items = organizerNavGroups({ eventId }).flatMap((g) => g.items)
    .filter((i) => i.href && i.href !== `/organizer/events/${eventId}` && pathname.startsWith(i.href));
  return items.sort((a, b) => b.href.length - a.href.length)[0]?.label || null;
}
