'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { useSavedSlugs, useSavedCount } from '../../hooks/useSavedEvents';
import EventCard from '../../components/EventCard';
import NavIcon from '../../components/shell/NavIcon';
import { Loading } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The events this browser has saved.
 *
 * THE HEART HAD NOWHERE TO GO. `SaveEventButton` has been on every event card
 * and every event page for as long as both have existed, writing slugs into
 * localStorage — and there was no screen anywhere in the product that read them
 * back. The one chip that linked here pointed at a route that had never been
 * built, so it 404'd, and removing the chip left the feature collecting state
 * nobody could see. This is the missing half.
 *
 * CLIENT-RENDERED, NECESSARILY. The list is in localStorage, which does not
 * exist on the server, so there is nothing to prerender and nothing to cache.
 * That is also why the route is `noindex` and sits in `PRIVATE_PREFIXES`: a
 * crawler would fetch an empty page and index it as a real one.
 *
 * ONE REQUEST, NOT ONE PER SLUG. `?slugs=` resolves the whole list server-side.
 * Twenty saved events used to mean twenty round trips on a phone to draw one
 * page, which is the reason the endpoint gained the parameter.
 *
 * A SAVED EVENT THAT NO LONGER EXISTS SIMPLY DROPS. Unpublished, cancelled,
 * renamed — the API returns what it has and says nothing about the rest, which
 * is deliberate on its side. So the count here is "how many we could find",
 * never "how many you saved", and the gap is explained below rather than
 * presented as a failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SavedEvents() {
  // The count comes from the store so it stays live: unsaving from a card on
  // this page updates it without a refetch.
  const savedCount = useSavedCount();

  const [state, setState] = useState({ events: null, error: null });

  /**
   * `null` = localStorage not read yet (the server snapshot and the first
   * render); `''` = read, nothing saved; otherwise the joined slugs.
   *
   * Straight from the store, with no effect and no second copy in state. The
   * effect-and-setState version this replaced was refused by
   * `react-hooks/set-state-in-effect`, and correctly — it is a render React
   * paints and immediately discards.
   */
  const joined = useSavedSlugs();

  useEffect(() => {
    // Nothing to ask for: not read yet, or read and empty. The empty case is
    // answered during render below rather than by writing `[]` into state.
    if (!joined) return undefined;

    let cancelled = false;
    (async () => {
      try {
        // `includePast=true`: a saved event that has already happened is still
        // the thing this person asked to keep, and dropping it silently would
        // read as the save having been lost.
        const data = await get(
          `/public/events?includePast=true&limit=200&slugs=${encodeURIComponent(joined)}`,
          { cache: 'no-store', noRedirect: true },
        );
        if (!cancelled) setState({ events: Array.isArray(data) ? data : [], error: null });
      } catch (error) {
        if (!cancelled) setState({ events: null, error });
      }
    })();
    return () => { cancelled = true; };
  }, [joined]);

  // Derived, not stored: an empty saved list needs no request and no state.
  const settled = joined === '' ? { events: [], error: null } : state;

  if (joined === null || (!settled.events && !settled.error)) {
    return <Loading variant="list" rows={3} label="Loading your saved events" />;
  }

  if (settled.error) {
    return (
      <Shell>
        <span aria-hidden className="es-empty__mark"><NavIcon name="alert" size={22} /></span>
        <p className="text-md font-medium text-ink">We could not load your saved events.</p>
        <p className="max-w-[44ch] text-center text-sm text-muted">{messageFor(settled.error)}</p>
        <p className="text-center text-sm text-subtle">
          Nothing has been lost — they are still saved on this device.
        </p>
      </Shell>
    );
  }

  const events = settled.events || [];

  if (events.length === 0) {
    return (
      <Shell>
        <span aria-hidden className="es-empty__mark"><NavIcon name="heart" size={22} /></span>
        <p className="text-md font-medium text-ink">
          {savedCount > 0 ? 'Your saved events are no longer on sale.' : 'Nothing saved yet.'}
        </p>
        <p className="max-w-[44ch] text-center text-sm text-muted">
          {savedCount > 0
            ? 'Events come off the list when they are no longer listed by their organizer.'
            : 'Tap the heart on any event to keep it here. Saved on this device — no account needed.'}
        </p>
        <Link href="/events" className="es-btn es-btn--primary es-btn--sm">Browse events</Link>
      </Shell>
    );
  }

  // Only when some saved slug did not come back. Silence would be worse: the
  // person knows how many hearts they tapped.
  const missing = savedCount - events.length;

  return (
    <div className="fx-stack">
      <div className="es-ev-toolbar">
        <p className="es-ev-count" aria-live="polite">
          <b>{events.length}</b> saved {events.length === 1 ? 'event' : 'events'}
        </p>
        <p className="text-sm text-subtle">Saved on this device</p>
      </div>

      {missing > 0 && (
        <p className="text-sm text-subtle" role="status">
          {missing} saved {missing === 1 ? 'event is' : 'events are'} no longer listed and
          {missing === 1 ? ' is' : ' are'} not shown.
        </p>
      )}

      <ul className="es-ev-results">
        {events.map((event, i) => (
          <li key={event.id}>
            <EventCard event={event} priority={i < 3} headingLevel={2} adaptive />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The empty and failed states share a shape — both are one mark, two lines
 *  and a way onward, in the same box the browse page uses. */
function Shell({ children }) {
  return <div className="es-empty es-empty--rich">{children}</div>;
}
