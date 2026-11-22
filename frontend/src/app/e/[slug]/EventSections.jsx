import Image from 'next/image';
import { safeExternalUrl } from '../../utils/safeUrl';
import VenueCard from './VenueCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event page's content sections: highlights, schedule, sponsors, policies,
 * and the venue map.
 *
 * ALL SERVER COMPONENTS. None of them has state, a handler or an effect — they
 * are text and pictures rendered from data the page already has. Marking them
 * `'use client'` would ship their markup twice, once as HTML and again as a
 * hydration payload, for behaviour none of them has. The gallery is the one
 * exception in this folder, because a lightbox genuinely is behaviour.
 *
 * EVERY SECTION RETURNS NULL WHEN EMPTY. A heading over nothing tells the
 * reader the organizer forgot something, when in fact most events have no
 * sponsors and that is unremarkable. The page is built from what exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The facts people scan for before they read anything: doors, age limit,
 * parking. Set as pills rather than a list, because they are read in any order
 * and none is more important than another.
 */
export function EventHighlights({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <ul className="fx-row flex-wrap gap-2" aria-label="Event highlights">
      {items.map((text, i) => (
        <li
          key={`${text}-${i}`}
          className="rounded-full border border-border-base bg-bg-sunken px-3 py-1 text-sm text-ink"
        >
          {text}
        </li>
      ))}
    </ul>
  );
}

/**
 * The running order.
 *
 * Times are formatted in the EVENT's zone, not the reader's, and the zone is
 * named once at the end. A festival's 23:00 set is at 23:00 where the festival
 * is; rendering it in the reader's own zone would show a different number to
 * everyone who travels to it, which is everyone who needs the schedule.
 *
 * Rows without a time keep their place in the order rather than being dropped
 * to the bottom — an organizer who has not fixed the clock yet has still told
 * you what happens after what.
 */
export function EventSchedule({ items = [], timezone }) {
  if (items.length === 0) return null;

  const at = (iso) => {
    if (!iso) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      // An unknown zone must not take the schedule down with it.
      return new Date(iso).toISOString().slice(11, 16);
    }
  };

  return (
    <section className="fx-stack" aria-labelledby="event-schedule">
      <h2 id="event-schedule" className="text-lg">Schedule</h2>
      <ol className="fx-stack fx-stack--sm">
        {items.map((item) => (
          <li
            key={item.id}
            className="fx-row flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border-base pt-3 first:border-0 first:pt-0"
          >
            <span className="es-nums w-28 shrink-0 text-sm font-medium text-ink">
              {at(item.startsAt) || <span className="text-subtle">—</span>}
            </span>
            <span className="fx-min0 flex-1">
              <span className="block text-ink">{item.title}</span>
              {item.location && <span className="block text-sm text-subtle">{item.location}</span>}
              {item.description && (
                <span className="mt-1 block whitespace-pre-line text-sm text-muted">{item.description}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {items.some((i) => i.startsAt) && (
        <p className="text-xs text-subtle">All times are local to the venue ({timezone}).</p>
      )}
    </section>
  );
}

/**
 * The organizer's policies.
 *
 * `<details>` rather than an accordion component: it opens without JavaScript,
 * it is searchable by the browser's own find-in-page in modern engines, and it
 * is announced correctly with no ARIA at all. A refund policy nobody can find
 * is the one that gets argued about.
 */
export function EventPolicies({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <section className="fx-stack" aria-labelledby="event-policies">
      <h2 id="event-policies" className="text-lg">Good to know</h2>
      <div className="fx-stack fx-stack--sm">
        {items.map((policy) => (
          <details
            key={policy.id}
            className="rounded-(--es-radius-md) border border-border-base px-4 py-3"
          >
            <summary className="cursor-pointer text-ink marker:text-subtle">{policy.title}</summary>
            <div className="fx-break mt-2 max-w-[70ch] whitespace-pre-line text-sm text-muted">
              {policy.body}
            </div>
          </details>
        ))}
      </div>
      <p className="text-xs text-subtle">
        Set by the organizer for this event. Eventsli&apos;s own terms apply to every purchase.
      </p>
    </section>
  );
}

/**
 * Where the venue is — the "Getting there" card (VenueCard.jsx, 2026-11-22).
 * A name or an address is enough; the pin only adds the live map.
 */
export function VenueMap({ venue, address, city, country, location }) {
  if (!venue && !address && !location) return null;
  return <VenueCard venue={venue} address={address} city={city} country={country} location={location} />;
}
