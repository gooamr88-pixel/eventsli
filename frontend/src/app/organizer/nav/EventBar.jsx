'use client';

import { useId } from 'react';
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
 * event's name in full before it offers to change it.
 *
 * ONE CONTROL, AND ONLY ONE. "Create event" used to sit in this bar too, on
 * the argument that starting an event and switching between them are the same
 * question asked at different times. On a phone that argument does not
 * survive contact with the screen: the bar became a label, a truncated event
 * name, a chevron and a bright blue button, all on one 360px row, directly
 * under an app bar and directly above a strip of section tabs. Three rows of
 * navigation before any of the page.
 *
 * Starting an event is also not something you do FROM an event. It belongs
 * where you are looking at the whole list — the dashboard and Your events —
 * and that is the only place it is now.
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
export default function EventBar({ events, currentId }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname() || '';

  // Nothing to switch between, so no bar at all. An organizer with no events
  // sees the dashboard's own "getting started" panel, and a strip saying
  // "Choose an event" above it would be a control with nothing in it.
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) return null;

  const current = list.find((e) => e.id === currentId) || null;

  return (
    /* A STRIP, NOT A CARD. It used to be a rounded, shadowed box inside
       `<main>`'s padding, stickied on its own — so at `lg`, where it pins to
       the top of the window, the page scrolled up through its corner radius
       and past it in the gutters either side. As part of the shell's top group
       it spans the full width and stacks under the app bar like a sub-header,
       with `__inner` holding its contents to the same column `.es-app-main`
       uses so the event name lines up with the page below it. */
    <div className="es-evbar">
      <div className="es-evbar__inner">
        <label htmlFor={id} className="es-evbar__label">Working on</label>

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
      </div>
    </div>
  );
}
