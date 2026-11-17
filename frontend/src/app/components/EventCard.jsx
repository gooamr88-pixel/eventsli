import Link from 'next/link';
import Image from 'next/image';
import { formatMoneyCompact } from '../utils/money';
import NavIcon from './shell/NavIcon';
import SaveEventButton from './SaveEventButton';
import { isDateOnly, formatDateOnly } from '../lib/dateOnly';
import { comingSoonLabel } from '../lib/comingSoon';
import CoverBrand from './brand/CoverBrand';

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
 * RESTYLED 2026-11-15 to the homepage concept: the heart on the artwork, the
 * title, the place behind a coral pin, and at the foot the price opposite a
 * coral "Get Tickets" pill. The pill is a SPAN, styled as a button — the card
 * is already the link, and it says where the link goes.
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
    year: format({ year: 'numeric' }),
  };
}

/**
 * The price block: a small label over a bold value, or null when there is
 * nothing honest to say. The listing endpoint sends `fromPriceCents`; the
 * single-event payload sends `tiers` instead, so both are read.
 */
export function priceBlock(event) {
  // A coming-soon teaser has no announced price (the API sends none).
  if (event.comingSoon) return null;
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
 * The sale tag on the artwork (owner, 2026-11-15): which events can actually
 * be bought here, at a glance, in a colour of its own.
 *
 *   on-sale   yellow   ticketed, and something is buyable (a price exists)
 *   sold-out  dark     every ticket has gone
 *   info      grey     a display-only listing: information, no tickets here
 *
 * Null when none is honest — a ticketed event whose sales have not opened
 * yet has no buyable price, and claiming "on sale" would be untrue.
 * Exported for its test.
 */
export function saleTag(event) {
  // Announced, not on sale yet (2026-11-17) — coral, never the yellow of "on sale".
  if (event.comingSoon) return { kind: 'soon', label: 'Coming soon' };
  if (event.displayOnly) return { kind: 'info', label: 'Info only' };
  if (event.availability?.soldOut) return { kind: 'sold-out', label: 'Sold out' };
  const buyable = 'fromPriceCents' in event
    ? event.fromPriceCents !== null && event.fromPriceCents !== undefined
    : (event.tiers || []).length > 0;
  return buyable ? { kind: 'on-sale', label: 'Tickets on sale' } : null;
}

/** What the card's pill says. Decorative — the card's link is the action. */
export function ctaLabel(event) {
  if (event.comingSoon) return 'Notify me';
  if (event.displayOnly) return 'Details';
  if (event.availability?.soldOut) return 'View event';
  // Nothing buyable yet (sales not open): the same rule as the sale tag, so
  // a card never says "Get Tickets" without a ticket to get.
  if (!saleTag(event)) return 'View event';
  return 'Get Tickets';
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
  const tag = saleTag(event);

  return (
    /**
     * A POSITIONED WRAPPER, so the heart can sit over the artwork without
     * living inside the card's anchor.
     *
     * The whole card is one `<Link>`, and a `<button>` inside an `<a>` is
     * invalid HTML that browsers recover from inconsistently — in practice the
     * click navigates instead of saving. `h-full` keeps the card filling its
     * grid cell, which `.es-evcard { height: 100% }` was already relying on.
     */
    <div className={`es-evcard-wrap ${adaptive ? 'es-evcard-wrap--adaptive' : ''}`}>
    <Link href={`/e/${event.slug}`} className={`es-evcard ${adaptive ? 'es-evcard--adaptive' : ''}`}>
      <div className="es-evcard__media">
        {/* THE WHOLE POSTER on a phone (owner, 2026-11-15): the cover is shown
            uncropped (`contain`) over a blurred copy of itself that fills the
            frame. The same src and sizes, so the browser fetches it once. */}
        {event.coverUrl && (
          <Image
            src={event.coverUrl}
            alt=""
            aria-hidden
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
            priority={priority}
            className="es-evcard__blur"
          />
        )}
        {event.coverUrl ? (
          <Image
            src={event.coverUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
            // Only the first row above the fold. Marking every card priority
            // means none of them is.
            priority={priority}
            className="es-evcard__art"
          />
        ) : (
          /* No cover is a normal state: an event may publish without artwork.
             The title on the brand tint reads as a deliberate cover rather
             than as the card that failed to load. */
          <span className="es-evcard__placeholder">{event.title}</span>
        )}

        {/* The Eventsli badge, on a real cover only (CoverBrand.jsx). */}
        {event.coverUrl && <CoverBrand />}

        {tag && (
          <span className={`es-evcard__sale es-evcard__sale--${tag.kind}`}>
            {tag.kind === 'on-sale' && <NavIcon name="ticket" size={14} />}
            {tag.kind === 'soon' && <NavIcon name="bell" size={14} />}
            {tag.label}
          </span>
        )}

        {when && (
          /* A teaser has a month, not a day: "MAR / 2027" rather than a "01"
             nobody chose. */
          <span className="es-lp-datebadge">
            <b>{event.comingSoon ? when.month : when.day}</b>
            <small>{event.comingSoon ? when.year : when.month}</small>
          </span>
        )}
      </div>

      <div className="es-evcard__body">
        <Heading className="es-evcard__title">{event.title}</Heading>

        <div className="es-evcard__meta">
          {when && (
            <p className="es-evcard__line">
              <span aria-hidden className="es-evcard__icon"><NavIcon name="clock" size={16} /></span>
              {/* A date-only listing shows its day(s), never a midnight. */}
              <span>
                {event.comingSoon
                  ? comingSoonLabel(event, { style: 'short' })
                  : isDateOnly(event) ? formatDateOnly(event, { style: 'short' }) : `${when.weekday} · ${when.time}`}
              </span>
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
          {price ? (
            <span className="es-evcard__price">
              {price.label}
              <b>{price.value}</b>
            </span>
          ) : <span />}
          <span aria-hidden className="es-evcard__cta">
            {ctaLabel(event)}
            <NavIcon name="arrow" size={14} />
          </span>
        </div>
      </div>
    </Link>

    {/* OVER THE ARTWORK — which is not always the card's top-right corner.

        This was `absolute right-4 top-4`, measured from the CARD. In the tall
        layout the art is the full width of the top, so that is the art's
        corner and the heart sat on it correctly. In the `--adaptive` layout
        the card is a ROW — art on the left, words on the right — and the same
        coordinates put the heart on top of the TITLE: a grey disc covering the
        end of "Laugh Out Loud: Eight Comics, One Night".

        `.es-evcard__save` moves it per layout, from the same two numbers the
        art itself is sized by, so the two cannot drift apart. */}
    <SaveEventButton
      slug={event.slug}
      title={event.title}
      className="es-evcard__save"
    />
    </div>
  );
}
