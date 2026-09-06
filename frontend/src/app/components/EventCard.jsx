import Link from 'next/link';
import Image from 'next/image';
import { formatPriceRange } from '../utils/money';

/**
 * One event in a listing. Used by the homepage and by /events, so the two can
 * never drift into showing different facts about the same event.
 *
 * A server component: it renders inside an SSR'd list and holds no state, so
 * shipping it to the browser would cost bytes for nothing.
 */

const DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
});

/**
 * @param {object}  props
 * @param {number} [props.headingLevel]  2 or 3 — see below
 *
 * THE HEADING LEVEL IS THE CALLER'S, because the correct one depends on what
 * is above the card and a component cannot know that.
 *
 * On `/events` the cards sit directly under the page's `<h1>`, so they are
 * `<h2>`. On the homepage they sit under an `<h2>` reading "On soon", so they
 * are `<h3>`. Hard-coding either one makes the other page skip a level, which
 * is what Lighthouse reported: `heading-order` on /events, from an `<h3>` with
 * no `<h2>` anywhere above it.
 *
 * That is not a pedantic finding. Screen reader users navigate by heading, and
 * a skipped level reads as "something was missed" — the listener goes back
 * looking for a section that does not exist.
 */
export default function EventCard({ event, priority = false, headingLevel = 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const price = formatPriceRange((event.tiers || []).map((t) => t.priceCents), event.currency);

  return (
    <Link
      href={`/e/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-[--es-radius-lg] border border-border-base bg-surface transition-shadow hover:shadow-md focus-visible:shadow-md"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-bg-sunken">
        {event.coverUrl ? (
          <Image
            src={event.coverUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 340px"
            // Only the first row above the fold. Marking every card priority
            // means none of them is, and the browser fetches twenty images at
            // once on a phone connection.
            priority={priority}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          /* No cover is a normal state, not an error: an event may publish
             without artwork. A typographic placeholder built from the title
             beats a broken image and beats a stock photo of a crowd that is
             not this crowd. */
          <div className="flex h-full items-center justify-center px-4">
            <span className="line-clamp-2 text-center font-serif text-xl text-subtle">
              {event.title}
            </span>
          </div>
        )}

        {event.displayOnly && (
          <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.09em] text-muted backdrop-blur">
            Listing
          </span>
        )}
      </div>

      <div className="fx-stack fx-stack--sm p-4">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">
          {DATE.format(new Date(event.startsAt))}
        </p>
        <Heading className="fx-break text-lg leading-snug">{event.title}</Heading>
        <p className="fx-truncate text-sm text-muted">
          {event.venue || event.organizer?.name || '—'}
        </p>

        <div className="fx-row fx-row--between">
          {price ? (
            <p className="es-nums text-sm font-medium text-ink">{price}</p>
          ) : (
            <p className="text-sm text-subtle">
              {event.displayOnly ? 'Details only' : 'Tickets available'}
            </p>
          )}
          {/* Sold out is the one status worth interrupting the card for: it is
              the difference between clicking and not. `availability` is only
              present on the single-event payload, so a listing that lacks it
              simply says nothing rather than guessing. */}
          {event.availability?.soldOut && (
            <span className="rounded-full bg-bg-sunken px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
              Sold out
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
