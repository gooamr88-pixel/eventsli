'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavIcon from '../../../components/shell/NavIcon';
import { organizerNavGroups } from '../../nav/organizerNav';
import { useEventContext } from './EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "DONE HERE — WHAT NEXT?" at the foot of every build screen.
 *
 * The creation wizard ends the moment the event row exists, and everything that
 * makes it sellable — ticket types, the seat map, the page, the discounts — is
 * a separate screen reached from the launch checklist. Each of those screens
 * was a dead end: it saved, and then offered nothing. To do the next thing you
 * had to know to go back to the overview and read the checklist again, which
 * is a step the wizard had spent five screens teaching you not to need.
 *
 * So each build screen now ends the way the wizard's steps did: with the way
 * back and the way on.
 *
 * THE ORDER IS THE SIDEBAR'S ORDER, from `organizerNavGroups` — the same list
 * that decides which screens this event has at all. That matters more than it
 * looks: a general-admission event has no seat map and no table categories, so
 * "next" after Ticket types is Discounts, not a map that does not exist. A
 * hand-written order here would have to know that rule too, and would be the
 * copy that forgets it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BuildNav() {
  const pathname = usePathname() || '';
  const { eventId, event } = useEventContext() || {};

  // Nothing until the event has loaded: the steps depend on what KIND of event
  // it is, and guessing produces a bar that changes under the reader.
  if (!eventId || !event) return null;

  const steps = organizerNavGroups({
    eventId,
    listingType: event.listingType || null,
    admissionType: event.admissionType || null,
  })
    .filter((g) => ['build', 'sell', 'day'].includes(g.id))
    .flatMap((g) => g.items)
    .filter((item) => item.href);

  const here = steps.findIndex((s) => s.href === pathname);
  if (here < 0) return null;

  const previous = steps[here - 1] || null;
  const next = steps[here + 1] || null;
  if (!previous && !next) return null;

  return (
    <nav className="es-buildnav" aria-label="Event setup steps">
      {previous ? (
        <Link href={previous.href} className="es-buildnav__back">
          <span aria-hidden className="es-buildnav__arrow es-buildnav__arrow--back">
            <NavIcon name="arrow" size={16} />
          </span>
          <span className="fx-min0">
            <span className="es-buildnav__label">Back</span>
            <span className="es-buildnav__name fx-truncate">{previous.label}</span>
          </span>
        </Link>
      ) : <span />}

      {next && (
        <Link href={next.href} className="es-buildnav__next">
          <span className="fx-min0">
            <span className="es-buildnav__label">Next</span>
            <span className="es-buildnav__name fx-truncate">{next.label}</span>
          </span>
          <span aria-hidden className="es-buildnav__arrow"><NavIcon name="arrow" size={16} /></span>
        </Link>
      )}
    </nav>
  );
}
