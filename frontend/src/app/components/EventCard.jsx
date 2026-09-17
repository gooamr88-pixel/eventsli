import Link from 'next/link';
import Image from 'next/image';
import { formatMoneyCompact } from '../utils/money';
import { categoryLabel } from '../lib/categories';
import NavIcon from './shell/NavIcon';

/**
 * One event in a listing. Used by the homepage and by /events, so the two can
 * never drift into showing different facts about the same event.
 *
 * A server component: it holds no state. The homepage's category tabs import
 * it from a client component too, which is fine for the same reason.
 *
 * ── REBUILT 2026-09-17 to the approved storefront card ─────────────────────
 * The date is a badge ON the artwork — it is the second thing a buyer checks
 * and the first thing compared between two cards. Under the title: when
 * (weekday · time) and where. At the foot, behind a rule: the category on one
 * side and the lowest price on the other, so a row of cards lines up its
 * prices whatever the titles' lengths.
 *
 * The whole card is ONE link. There is no button inside it: an <a> or <button>
 * inside a link is invalid HTML, and two targets on one card is one more than
 * a thumb can tell apart.
 */

/** Every date part in the EVENT's timezone. A shared formatter used the
 *  reader's zone, so a late show in Vancouver read as the next day to someone
 *  in Toronto. */
export function eventDateParts(event) {
  const at = new Date(event.startsAt);
  if (Number.isNaN(at.getTime())) return null;
  const format = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: event.timezone || undefined }).format(at);
    } catch {
      // An unrecognised zone name throws; the reader's zone beats a crashed list.
      return new Intl.DateTimeFormat('en-US', opts).format(at);
    }
  };
  return {
    day: format({ day: '2-digit' }),
    month: format({ month: 'short' }),
    weekday: format({ weekday: 'short' }),
    time: format({ hour: 'numeric', minute: '2-digit' }).toLowerCase(),
  };
}

/**
 * The price block: a small label over a bold value, or null when there is
 * nothing honest to say. The listing endpoint sends `fromPriceCents`; the
 * single-event payload sends `tiers` instead, so both are read.
 */
function priceBlock(event) {
  if (event.displayOnly) return { label: 'Listing', value: 'Details' };
  if (event.availability?.soldOut) return { label: 'Tickets', value: 'Sold out' };

  const prices = (event.tiers || []).map((t) => t.priceCents);
  if (event.fromPriceCents !== null && event.fromPriceCents !== undefined) prices.push(event.fromPriceCents);
  const valid = prices
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n));

  if (valid.length === 0) return null;
  const low = Math.min(...valid);
  if (low === 0) return { label: 'Tickets', value: 'Free' };
  return { label: 'From', value: formatMoneyCompact(low, event.currency) };
}

/**
 * @param {number} [props.headingLevel]  2 or 3 — THE CALLER'S, because the
 * correct one depends on what is above the card. On /events the cards sit
 * under the page's <h1>; on the homepage under an <h2>. Hard-coding either
 * makes the other page skip a level, and screen reader users navigate by it.
 *
 * @param {boolean} [props.adaptive]  below md, lay the card out as a compact ROW
 * (photo left, details right). For long listings on a phone, where one tall
 * card per screen turns browsing ten events into ten screens of scrolling.
 */
export default function EventCard({ event, priority = false, headingLevel = 3, adaptive = false }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const when = eventDateParts(event);
  const place = [event.venue, event.city].filter(Boolean).join(', ') || event.organizer?.name || '';
  const price = priceBlock(event);

  return (
    <Link href={`/e/${event.slug}`} className={`es-evcard ${adaptive ? 'es-evcard--adaptive' : ''}`}>
      <div className="es-evcard__media">
        {event.coverUrl ? (
          <Image
            src={event.coverUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
            // Only the first row above the fold. Marking every card priority
            // means none of them is.
            priority={priority}
            className="object-cover"
          />
        ) : (
          /* No cover is a normal state: an event may publish without artwork.
             The title on the brand tint reads as a deliberate cover rather
             than as the card that failed to load. */
          <span className="es-evcard__placeholder">{event.title}</span>
        )}

        {when && (
          <span className="es-lp-datebadge">
            <b>{when.day}</b>
            <small>{when.month}</small>
          </span>
        )}
      </div>

      <div className="es-evcard__body">
        <Heading className="es-evcard__title">{event.title}</Heading>

        <div className="es-evcard__meta">
          {when && (
            <p className="es-evcard__line">
              <span aria-hidden className="es-evcard__icon"><NavIcon name="clock" size={16} /></span>
              <span>{`${when.weekday} · ${when.time}`}</span>
            </p>
          )}
          {place && (
            <p className="es-evcard__line">
              <span aria-hidden className="es-evcard__icon"><NavIcon name="pin" size={16} /></span>
              <span className="fx-truncate">{place}</span>
            </p>
          )}
        </div>

        <div className="es-evcard__foot">
          <span className="es-evcard__tag">
            {event.category ? categoryLabel(event.category) : 'Event'}
          </span>
          {price && (
            <span className="es-evcard__price">
              {price.label}
              <b>{price.value}</b>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
