import { addressLine, addressParts } from '../lib/venueAddress';
import Link from 'next/link';
import Image from 'next/image';
import NavIcon from '../components/shell/NavIcon';
import { priceBlock, saleTag, ctaLabel } from '../components/EventCard';
import { isDateOnly, formatDateOnly } from '../lib/dateOnly';
import PrivateCardCover from '../components/PrivateCardCover';
import EventPartners from './EventPartners';
import OpenCalls, { openCallLinks } from '../components/OpenCalls';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event on /events — built to the owner's reference screenshot (2026-11-19):
 * a white card holding the poster, the title, "date · time" behind a calendar,
 * the street address behind a pin, a small tinted "Tickets" tag, and a solid
 * "Tickets From CA$120" button.
 *
 * The homepage, organizer pages and saved list keep `EventCard`; this layout is
 * the /events grid only. The sale rules (what is buyable, what the price is)
 * are EventCard's own helpers, so the two cards never disagree about an event.
 *
 * The whole card is one link, like EventCard: the "button" is a span styled as
 * one, because a button inside an anchor is invalid HTML.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** "Nov 6, 2026 · 8:30 pm", in the EVENT's timezone. */
export function gridWhen(event) {
  if (event.comingSoon) return null; // no date on a teaser (owner, 2026-11-18)
  if (isDateOnly(event)) return formatDateOnly(event, { style: 'short' }) || null;
  const at = new Date(event.startsAt);
  if (Number.isNaN(at.getTime())) return null;
  const format = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: event.timezone || undefined }).format(at);
    } catch {
      return new Intl.DateTimeFormat('en-US', opts).format(at);
    }
  };
  const date = format({ month: 'short', day: 'numeric', year: 'numeric' });
  const time = format({ hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${date} · ${time}`;
}

/** The street address when the organizer gave one, else venue + city. */
export function gridPlace(event) {
  // A private event names its organizer, never a place (2026-11-23).
  if (event.isPrivate) return event.organizer?.name ? `By ${event.organizer.name}` : '';
  // The full address when there is a street; a city alone reads better with the venue.
  return (addressParts(event).street ? addressLine(event) : null)
    || [event.venue, event.city].filter(Boolean).join(', ')
    || '';
}

/** The small tinted tag above the button. "Tickets" when on sale. */
const TAG_LABEL = {
  'on-sale': 'Tickets',
  fast: 'Selling fast',
  'sold-out': 'Sold out',
  info: 'Info only',
  soon: 'Coming soon',
  // "Completed" (owner, 2026-11-28): finished events stay listed, marked.
  past: 'Completed',
  private: 'Private event',
};

/** The button: "Tickets From CA$120" whenever a price can be bought. */
export function gridCta(event) {
  const tag = saleTag(event);
  const price = priceBlock(event);
  if (tag && (tag.kind === 'on-sale' || tag.kind === 'fast') && price) {
    return price.value === 'Free' ? 'Free Tickets' : `Tickets From ${price.value}`;
  }
  if (tag?.kind === 'sold-out') return 'Sold out';
  return ctaLabel(event);
}

export default function EventGridCard({ event, priority = false }) {
  const when = gridWhen(event);
  const place = gridPlace(event);
  const tag = saleTag(event);
  const muted = event.isPast || tag?.kind === 'sold-out';

  const card = (
    <Link href={`/e/${event.slug}`} className={`es-evx-card ${event.isPast ? 'es-evx-card--past' : ''}`}>
      <div className="es-evx-card__media">
        {/* COMPLETED (owner, 2026-11-28): finished events stay on the page,
            marked over the poster. The poster goes grey; the badge, which
            is not inside the greyed image, stays crisp. */}
        {event.isPast && (
          <span className="es-evx-done">
            <span className="es-evx-done__mark" aria-hidden="true"><NavIcon name="tick" size={12} /></span>
            Completed
          </span>
        )}
        {event.isPrivate ? (
          /* Listed, blurred (owner, 2026-11-23): name, organizer, date only. */
          <PrivateCardCover event={event} />
        ) : event.coverUrl ? (
          <>
            {/* The whole poster, never cropped: shown `contain` over a blurred
                copy of itself (owner, 2026-11-15). Same src, fetched once. */}
            <Image
              src={event.coverUrl}
              alt=""
              aria-hidden
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 420px"
              priority={priority}
              className="es-evx-card__blur"
            />
            <Image
              src={event.coverUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 420px"
              priority={priority}
              className="es-evx-card__art"
            />
          </>
        ) : (
          <span className="es-evx-card__placeholder">{event.title}</span>
        )}
      </div>

      <h2 className="es-evx-card__title">{event.title}</h2>

      <div className="es-evx-card__meta">
        {when && (
          <p className="es-evx-card__line">
            <NavIcon name="calendar" size={18} className="es-evx-card__icon" />
            <span>{when}</span>
          </p>
        )}
        {place && (
          <p className="es-evx-card__line">
            <NavIcon name={event.isPrivate ? 'user' : 'pin'} size={18} className="es-evx-card__icon" />
            <span>{place}</span>
          </p>
        )}
      </div>

      <div className="es-evx-card__foot">
        {tag && <span className={`es-evx-card__tag es-evx-card__tag--${tag.kind}`}>{TAG_LABEL[tag.kind]}</span>}
        <span aria-hidden className={`es-evx-card__cta ${muted ? 'es-evx-card__cta--muted' : ''}`}>
          {gridCta(event)}
        </span>
      </div>

      {/* Its sponsors and vendors, at the foot of the card (2026-11-28). */}
      <EventPartners partners={event.partners} />
    </Link>
  );

  // "Become a sponsor / vendor" badges (2026-11-28) sit under the card,
  // beside its link rather than inside it.
  if (!openCallLinks(event).length) return card;
  return (
    <div className="es-evx-cardwrap">
      {card}
      <OpenCalls event={event} />
    </div>
  );
}
