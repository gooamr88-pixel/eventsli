'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import WorkspaceSwitcher from '../components/shell/WorkspaceSwitcher';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { get } from '../utils/apiClient';
import EventBar from './nav/EventBar';
import { OrganizerEventsProvider } from './nav/OrganizerEvents';
import { organizerNavGroups, organizerTabs, eventIdFromPath } from './nav/organizerNav';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer shell.
 *
 * The sidebar replaced two tab strips — an account-wide one here and a
 * per-event one in events/[id]/layout — with one navigation that survives every
 * page change. Every route underneath is unchanged; this only arranges them.
 *
 * No auth or role check here, as before: `proxy.ts` bounces anyone without a
 * session, and every endpoint re-checks role and ownership per request. A
 * check in a layout would be the one a forged cookie gets past.
 *
 * The event the sidebar is about comes from the URL when there is one, and
 * otherwise from the last event visited — remembered in localStorage as a
 * convenience, and only honoured if it is still in this organizer's own list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LAST_EVENT_KEY = 'eventsli.organizer.lastEvent';

function readLastEvent() {
  try { return localStorage.getItem(LAST_EVENT_KEY); } catch { return null; }
}
function subscribeStorage(onChange) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export default function OrganizerLayout({ children }) {
  const pathname = usePathname() || '';
  const { user } = useAuth();
  const pathEventId = eventIdFromPath(pathname);
  const lastEventId = useSyncExternalStore(subscribeStorage, readLastEvent, () => null);

  // `{ events, error }` together, not an empty list on failure: the switcher
  // wants "nothing to switch between" and Your events wants "it did not load",
  // and those are different answers to the same request. See OrganizerEvents.
  const [state, setState] = useState({ events: null, error: null });
  /**
   * Bumped by `reload`, so "Your events" can ask again.
   *
   * That page renders this request's failure and had no way to re-run it — the
   * fetch lives here, in the layout, so its only recovery was reloading the
   * document. A counter in the fetch key is the same trick `useApi` uses, and
   * it keeps the one request that feeds both the switcher and the list.
   */
  const [version, setVersion] = useState(0);
  const events = state.events;
  // A brand-new event is not in a list fetched before it existed. Asking again
  // when the URL names an event the list does not know is what keeps the
  // switcher from saying "Choose an event…" on the event you just created.
  const stale = Boolean(pathEventId && events && !events.some((e) => e.id === pathEventId));
  const fetchKey = `${version}:${stale ? pathEventId : 'initial'}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/events?limit=200&sort=starts_at&order=desc', { cache: 'no-store', noRedirect: true });
        if (!cancelled) setState({ events: Array.isArray(data) ? data : [], error: null });
      } catch (error) {
        // No organizer profile yet answers 403 — an empty switcher, not an
        // error. The error is kept for the page that lists them, which does
        // have to say so.
        if (!cancelled) setState({ events: [], error });
      }
    })();
    return () => { cancelled = true; };
  }, [fetchKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Memoised, or every render of this layout would hand the context a new
  // object and re-render the switcher and the list with identical data.
  const eventsValue = useMemo(() => ({ ...state, reload }), [state, reload]);

  useEffect(() => {
    if (!pathEventId) return;
    try { localStorage.setItem(LAST_EVENT_KEY, pathEventId); } catch { /* private mode */ }
  }, [pathEventId]);

  const rememberedIsMine = Boolean(lastEventId && events?.some((e) => e.id === lastEventId));
  const eventId = pathEventId || (rememberedIsMine ? lastEventId : null);
  // A display-only event has no selling screens and a general-admission one has
  // no seat map; the sidebar leaves out what this event does not have. Both come
  // from the events list the switcher already loads, so neither costs a request.
  const current = events?.find((e) => e.id === eventId) || null;
  const listingType = current?.listingType || null;
  const admissionType = current?.admissionType || null;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <OrganizerEventsProvider value={eventsValue}>
        <AppShell
          workspace="Organizer"
          label="Organizer"
          home="/organizer"
          /**
           * NO `canCreate` ANY MORE, AND THE REASON IT EXISTED IS GONE.
           *
           * It put a second "Create event" in the sidebar because the event
           * bar's button was ICON-ONLY below 40rem — an unlabelled `+` beside a
           * chevron, which got reported as the button not existing. Both halves
           * of that fix shipped: `.es-evbar__new-word` now clips only the word
           * " event", so the bar reads "Create" on a phone and "Create event"
           * above it, at every width, labelled.
           *
           * The compensating duplicate was never taken back out. So the verb sat
           * in two places at once — once in this list and once in the bar at the
           * top of the same screen, same words, same route, a few hundred pixels
           * apart. The bar's copy is the one that survives: it is visible without
           * opening a drawer, which is the complaint that started all of this.
           */
          groups={organizerNavGroups({ eventId, listingType, admissionType })}
          // Only an event in the URL changes the bar; a remembered one does not.
          tabKeys={organizerTabs({ eventId: pathEventId, listingType })}
          // Before the organization exists there is nothing to create an event
          // under and no event to pick: setup is the page, and the sidebar does
          // not offer a shortcut past it.
          /**
           * THE HEAD HOLDS THE WORKSPACE SWITCHER AND NOTHING ELSE.
           *
           * It used to hold "Create event" and the EVENT switcher — the two
           * controls an organizer reaches for most — inside a panel that is a
           * DRAWER below `lg`. On a phone both were invisible until you went
           * looking, which is why neither could be found. Both are in `EventBar`
           * now, at the top of the page, at every width; a second copy here would
           * be two event switchers that can show different events.
           *
           * Changing WORKSPACE is the opposite kind of control: rare,
           * deliberate, and only for the accounts that have somewhere else to be.
           * Behind the menu is right for it, and it renders nothing at all for an
           * organizer who is only an organizer. It replaces the "Admin console"
           * link that used to sit in the footer beside "Sign out" — filed with
           * the exits, which is not what moving between the halves of the product
           * is.
           */
          head={<WorkspaceSwitcher />}
          /* Which event this is about, and the way to start another — in the
             shell's chrome directly under the app bar, so the two pin as one
             group. It was the first child of `<main>` with a hard-coded
             `top: 56px`, which is the app bar's height only on a phone with no
             notch. See the note on AppShell's props. */
          contextBar={(
            <EventBar events={events} currentId={eventId} canCreate={Boolean(user?.isOrganizer)} />
          )}
          // NO APP-BAR ACTION, deliberately. It was a phone-only "Create"
          // button, and the event bar directly under it now carries the same
          // one — two Create buttons stacked within 60px of each other is the
          // clutter this pass exists to remove.
          foot={(
            <ShellFoot
              user={user}
              // "Admin console" was here. It is a workspace, so it is in the
              // switcher at the top of this panel with the other ones — see
              // `head` above. What is left down here is leaving: the public site,
              // and out.
              links={[{ href: '/', label: 'View the site', icon: 'globe' }]}
            />
          )}
        >
          {children}
        </AppShell>
        </OrganizerEventsProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
