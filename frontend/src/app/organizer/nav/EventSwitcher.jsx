'use client';

import { useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { pathForEvent } from './organizerNav';

/**
 * "Working on" — which event the event-scoped half of the sidebar is about.
 *
 * Switching keeps the section: from one event's Orders to the next event's
 * Orders. A <select> rather than a custom menu, because on a phone the native
 * picker is the best list UI there is, and it is accessible without trying.
 */
export default function EventSwitcher({ events, currentId }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname() || '';

  if (!events || events.length === 0) return null;

  return (
    <div className="fx-stack fx-stack--sm gap-1">
      <label htmlFor={id} className="es-stat__label">Working on</label>
      <select
        id={id}
        className="es-input"
        value={currentId || ''}
        onChange={(e) => { if (e.target.value) router.push(pathForEvent(pathname, e.target.value)); }}
      >
        <option value="">Choose an event…</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>{event.title}</option>
        ))}
      </select>
    </div>
  );
}
