'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import NavIcon from '../components/shell/NavIcon';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { get } from '../utils/apiClient';
import EventSwitcher from './nav/EventSwitcher';
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
          head={user?.isOrganizer ? (
            <>
              {/* The money action, always one tap away. Its label is a nav
                  label, so the tablet rail shows the icon alone. */}
              <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--block es-nav__cta">
                <NavIcon name="plus" size={18} />
                <span className="es-nav__label">Create event</span>
              </Link>
              <div className="es-nav__rail-hide">
                <EventSwitcher events={events} currentId={eventId} />
              </div>
            </>
          ) : null}
          appbarAction={user?.isOrganizer ? (
            <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--sm md:hidden">
              <NavIcon name="plus" size={18} />
              Create
            </Link>
          ) : null}
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
          {children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}
