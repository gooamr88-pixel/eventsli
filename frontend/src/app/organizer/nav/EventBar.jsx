'use client';

import { useId } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import NavIcon from '../../components/shell/NavIcon';
import { pathForEvent } from './organizerNav';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH EVENT AM I WORKING ON — at the top of every organizer screen.
 *
 * The switcher existed, and it was in the sidebar's head. Below `lg` that head
 * is inside a DRAWER, so on a phone the control that decides what every other
 * screen is about was two taps away and invisible until you found it. An
 * organizer running four events had no way to tell, at a glance, which one the
 * numbers on screen belonged to.
 *
 * It is now the first thing on the page, at every width, and it says the
 * event's name in full before it offers to change it. "Create event" sits in
 * the same bar, because starting one and switching between them are the same
 * question asked at different times — and it was the other control people
 * could not find.
 *
 * A <select>, not a custom menu: on a phone the native picker is the best list
 * UI there is, it scrolls a hundred events without any work, and it is
 * accessible without trying.
 *
 * SWITCHING KEEPS THE SECTION. From one event's Orders to the next event's
 * Orders, not to its overview — which is what somebody comparing two events is
 * actually doing. `pathForEvent` owns that rule and the nav model tests it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventBar({ events, currentId, canCreate }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname() || '';

  // Nothing to switch between and nothing to create: no bar at all. An
  // organizer with no events sees the dashboard's own "getting started" panel,
  // and a strip saying "Choose an event" above it would be a control whose
  // only option is the one they have already been given.
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0 && !canCreate) return null;

  const current = list.find((e) => e.id === currentId) || null;

  return (
    <div className="es-evbar">
      <div className="es-evbar__main">
        <label htmlFor={id} className="es-evbar__label">Working on</label>

        {list.length > 0 ? (
          <div className="es-evbar__pick">
            <select
              id={id}
              className="es-evbar__select"
              value={current?.id || ''}
              onChange={(e) => { if (e.target.value) router.push(pathForEvent(pathname, e.target.value)); }}
            >
              <option value="">Choose an event…</option>
              {list.map((event) => (
                <option key={event.id} value={event.id}>{event.title}</option>
              ))}
            </select>
            <span aria-hidden className="es-evbar__chev"><NavIcon name="arrow" size={16} /></span>
          </div>
        ) : (
          <p className="es-evbar__none">No events yet</p>
        )}
      </div>

      {canCreate && (
        <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--sm es-evbar__new">
          <NavIcon name="plus" size={16} />
          <span className="es-evbar__new-label">Create event</span>
        </Link>
      )}
    </div>
  );
}
