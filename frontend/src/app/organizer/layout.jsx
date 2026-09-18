'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { get } from '../utils/apiClient';
import EventBar from './nav/EventBar';
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

  const [events, setEvents] = useState(null);
  // A brand-new event is not in a list fetched before it existed. Asking again
  // when the URL names an event the list does not know is what keeps the
  // switcher from saying "Choose an event…" on the event you just created.
  const stale = Boolean(pathEventId && events && !events.some((e) => e.id === pathEventId));
  const fetchKey = stale ? pathEventId : 'initial';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/events?limit=200&sort=starts_at&order=desc', { cache: 'no-store', noRedirect: true });
        if (!cancelled) setEvents(Array.isArray(data) ? data : []);
      } catch {
        // No organizer profile yet answers 403 — an empty switcher, not an error.
        if (!cancelled) setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchKey]);

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
        <AppShell
          role="Organizer"
          label="Organizer"
          home="/organizer"
          groups={organizerNavGroups({ eventId, listingType, admissionType })}
          // Only an event in the URL changes the bar; a remembered one does not.
          tabKeys={organizerTabs({ eventId: pathEventId, listingType })}
          // Before the organization exists there is nothing to create an event
          // under and no event to pick: setup is the page, and the sidebar does
          // not offer a shortcut past it.
          /**
           * THE SIDEBAR'S HEAD IS EMPTY NOW, and that is the fix rather than a
           * removal. It held "Create event" and the event switcher — the two
           * controls an organizer reaches for most — inside a panel that is a
           * DRAWER below `lg`. On a phone both were invisible until you went
           * looking, which is why neither could be found.
           *
           * Both are in `EventBar`, at the top of the page, at every width.
           * Keeping a second copy here would be two switchers that can show
           * different events.
           */
          head={null}
          // NO APP-BAR ACTION, deliberately. It was a phone-only "Create"
          // button, and the event bar directly under it now carries the same
          // one — two Create buttons stacked within 60px of each other is the
          // clutter this pass exists to remove.
          foot={(
            <ShellFoot
              user={user}
              links={[
                ...(user?.isAdmin ? [{ href: '/admin/overview', label: 'Admin console', icon: 'shield' }] : []),
                { href: '/', label: 'View the site', icon: 'globe' },
              ]}
            />
          )}
        >
          {/* First on the page, above everything: which event this is about,
              and the way to start another. `EventBar` argues why it is here
              rather than in the sidebar it came from. */}
          <EventBar events={events} currentId={eventId} canCreate={Boolean(user?.isOrganizer)} />
          {children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}
