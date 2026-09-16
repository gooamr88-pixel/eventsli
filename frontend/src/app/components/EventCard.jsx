import Link from 'next/link';
import Image from 'next/image';
import { formatPriceRange } from '../utils/money';
import { categoryLabel } from '../lib/categories';
import NavIcon from './shell/NavIcon';

/**
 * One event in a listing. Used by the homepage and by /events, so the two can
 * never drift into showing different facts about the same event.
 *
 * A server component: it renders inside an SSR'd list and holds no state, so
 * shipping it to the browser would cost bytes for nothing.
 *
 * ── REBUILT 2026-09-16 to the storefront design ────────────────────────────
 * Four things moved onto the artwork or into their own line, and each is a
 * decision about what a buyer scans for:
 *
 *   • THE DATE became a badge on the cover. It is the second thing checked
 *     after the picture and the first thing compared between two cards, and
 *     as the eyebrow under the image it was the same weight as the venue.
 *   • THE CATEGORY became a pill on the cover. It was not shown at all, so a
 *     row of four cards gave no way to tell a concert from a conference
 *     without reading every title.
 *   • THE PRICE is accent-coloured and sits on the card's last line, opposite
 *     the save control. It is the fact that decides a click.
 *   • THE VENUE gets a pin, because "Grand Nile Tower" without one reads as a
 *     subtitle rather than as a place.
 */

/** The day and month for the badge, in the EVENT's timezone. A shared
 *  formatter used the reader's zone, so a late show in Vancouver could read as
 *  the next day to someone in Toronto. */
function badgeParts(event) {
  const zone = event.timezone || undefined;
  const at = new Date(event.startsAt);
  const part = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone }).format(at);
    } catch {
      // An unrecognised zone name throws; the reader's zone beats a crashed list.
      return new Intl.DateTimeFormat('en-US', opts).format(at);
    }
  };
  return { day: part({ day: 'numeric' }), month: part({ month: 'short' }) };
}

/**
 * @param {object}  props
 * @param {number} [props.headingLevel]  2 or 3 — see below
 *
 * THE HEADING LEVEL IS THE CALLER'S, because the correct one depends on what
 * is above the card and a component cannot know that.
 *
 * On `/events` the cards sit directly under the page's `<h1>`, so they are
 * `<h2>`. On the homepage they sit under an `<h2>` reading "Featured events",
 * so they are `<h3>`. Hard-coding either one makes the other page skip a
 * level, which is what Lighthouse reported: `heading-order` on /events, from
 * an `<h3>` with no `<h2>` anywhere above it.
 *
 * That is not a pedantic finding. Screen reader users navigate by heading, and
 * a skipped level reads as "something was missed" — the listener goes back
 * looking for a section that does not exist.
 */
export default function EventCard({ event, priority = false, headingLevel = 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const price = formatPriceRange((event.tiers || []).map((t) => t.priceCents), event.currency);
  const { day, month } = badgeParts(event);

  return (
    <Link
      href={`/e/${event.slug}`}
      className="es-card es-card--flush es-card--interactive es-eventcard group"
    >
      <div className="es-figure es-figure--square">
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
             beats a broken image, and it sits on the field tone so it reads as
             a deliberate cover rather than as the card that failed. */
          <div className="es-band--field flex h-full items-end p-4">
            <span className="line-clamp-3 font-serif text-lg leading-tight text-ink">
              {event.title}
            </span>
          </div>
        )}

        {/* On the artwork, both of them, and both opaque. A frosted chip over
            a pale sky is unreadable, and these sit on photographs nobody on
            this side chose. */}
        <span className="es-datebadge">
          <span className="es-datebadge__day">{day}</span>
          <span className="es-datebadge__month">{month}</span>
        </span>

        {event.category && (
          <span className="es-pill es-eventcard__tag">{categoryLabel(event.category)}</span>
        )}

        {event.displayOnly && (
          <span className="es-pill es-eventcard__listing">Listing</span>
        )}
      </div>

      <div className="fx-stack fx-stack--sm gap-2 p-4">
        <Heading className="fx-break text-md font-semibold leading-snug">{event.title}</Heading>

        <p className="fx-row items-center gap-1.5 text-sm text-muted">
          <span aria-hidden className="shrink-0 text-subtle"><NavIcon name="pin" size={14} /></span>
          <span className="fx-truncate">{event.venue || event.organizer?.name || '—'}</span>
        </p>

        <div className="fx-row fx-row--between items-center pt-1">
          {price ? (
            <p className="es-nums text-sm font-semibold text-accent">{price}</p>
          ) : (
            <p className="text-sm text-muted">
              {event.displayOnly ? 'Details only' : 'Tickets available'}
            </p>
          )}

          <span className="fx-row items-center gap-2">
            {/* Sold out is the one status worth interrupting a card for: it is
                the difference between clicking and not. `availability` is only
                present on the single-event payload, so a listing that lacks it
                says nothing rather than guessing. */}
            {event.availability?.soldOut && <span className="es-pill">Sold out</span>}

            {/*
              THE HEART IS DECORATION, and it is marked as such.

              The reference design puts a save control here and this card is
              built to it — but there is no saved-events feature in this
              product, and a heart that does nothing when pressed is worse than
              no heart. It is `aria-hidden` inside a link, so it is never a
              control a keyboard or a screen reader can reach and fail at.
              When saving exists it becomes a real <button>; until then it is
              the shape the layout was designed around.
            */}
            <span aria-hidden className="es-eventcard__save"><NavIcon name="heart" size={16} /></span>
          </span>
        </div>
      </div>
    </Link>
  );
}
