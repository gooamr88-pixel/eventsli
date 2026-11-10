'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import NavIcon from '../../components/shell/NavIcon';
import SaveEventButton from '../../components/SaveEventButton';
import { eventDateParts, priceBlock } from '../../components/EventCard';
import { categoryLabel } from '../../lib/categories';
import { isDateOnly, formatDateOnly } from '../../lib/dateOnly';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "You might also like" — the owner's design (2026-11-10, image 2).
 *
 * A carousel of wide cards: neighbours peek in at the edges, a white arrow
 * steps back and a teal one steps on, and a dot per card says where you are.
 * Each card: the photo with a date badge and a heart, a soft wave where it
 * meets the card, the title, date and venue on one line, then the category
 * and the price with a round arrow.
 *
 * Native scrolling with scroll-snap underneath, so a swipe, a trackpad and a
 * keyboard all work; the arrows and dots only drive that scroll position.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function RelatedCarousel({ events, title, city, moreHref }) {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: events.length <= 1 });

  // Which card is first in view, and whether either end is reached — read on
  // scroll, so a swipe updates the dots exactly as the arrows do.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = [...track.children];
    const left = track.scrollLeft + track.clientWidth * 0.08;
    let index = 0;
    cards.forEach((card, i) => { if (card.offsetLeft - track.offsetLeft <= left + 4) index = i; });
    setActive(index);
    setEdges({
      start: track.scrollLeft <= 4,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const frame = requestAnimationFrame(measure);
    track.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const goTo = (index) => {
    const track = trackRef.current;
    const card = track?.children[Math.max(0, Math.min(events.length - 1, index))];
    if (!card) return;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft - parseFloat(getComputedStyle(track).scrollPaddingLeft || 0), behavior: 'smooth' });
  };

  const [lead, accent] = splitTitle(title);

  return (
    <section className="es-related" aria-labelledby="event-related">
      <span aria-hidden className="es-related__wave es-related__wave--top" />
      <span aria-hidden className="es-related__wave es-related__wave--bottom" />

      <div className="es-related__head">
        <div className="fx-min0">
          <h2 id="event-related" className="es-related__title">
            {lead} <span className="es-related__accent">{accent}</span>
            <svg className="es-related__spark" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 3l2.2 7.8L26 13l-7.8 2.2L16 23l-2.2-7.8L6 13l7.8-2.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M26 21l.9 2.6 2.6.9-2.6.9L26 28l-.9-2.6-2.6-.9 2.6-.9z" fill="currentColor" />
            </svg>
          </h2>
          <p className="es-related__lede">
            {city ? `Discover more events in ${city} and nearby.` : 'Discover more events you might enjoy.'}
          </p>
        </div>
        <Link href={moreHref} className="es-related__more">
          <NavIcon name="pin" size={20} />
          <span>{city ? `All events in ${city}` : 'All events'}</span>
          <NavIcon name="arrow" size={20} />
        </Link>
      </div>

      <div className="es-related__frame">
        {events.length > 1 && (
          <button
            type="button"
            className="es-related__nav es-related__nav--prev"
            onClick={() => goTo(active - 1)}
            disabled={edges.start}
            aria-label="Previous events"
          >
            <NavIcon name="chevronLeft" size={22} />
          </button>
        )}

        <ul ref={trackRef} className="es-related__track">
          {events.map((event) => <li key={event.id} className="es-related__item"><RelatedCard event={event} /></li>)}
        </ul>

        {events.length > 1 && (
          <button
            type="button"
            className="es-related__nav es-related__nav--next"
            onClick={() => goTo(active + 1)}
            disabled={edges.end}
            aria-label="More events"
          >
            <NavIcon name="chevronRight" size={22} />
          </button>
        )}
      </div>

      {events.length > 1 && (
        <div className="es-related__dots" role="group" aria-label="Choose an event">
          {events.map((event, i) => (
            <button
              key={event.id}
              type="button"
              className="es-related__dot"
              aria-current={i === active ? 'true' : undefined}
              aria-label={`Show ${event.title}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** "You might also like" → ["You might", "also like"]: the last two words in the accent. */
function splitTitle(title) {
  const words = String(title).split(' ');
  if (words.length < 3) return ['', title];
  return [words.slice(0, -2).join(' '), words.slice(-2).join(' ')];
}

function RelatedCard({ event }) {
  const when = eventDateParts(event);
  const place = [event.venue, event.city].filter(Boolean).join(', ') || event.organizer?.name || '';
  const price = priceBlock(event);
  const dateText = when && (isDateOnly(event) ? formatDateOnly(event, { style: 'short' }) : `${when.weekday} · ${when.time}`);
  const category = event.category ? (event.categoryLabel || categoryLabel(event.category)) : 'Event';

  return (
    <div className="es-rcard-wrap">
      <Link href={`/e/${event.slug}`} className="es-rcard">
        <div className="es-rcard__media">
          {event.coverUrl ? (
            <Image src={event.coverUrl} alt="" fill sizes="(max-width: 640px) 85vw, 520px" className="es-rcard__art" />
          ) : (
            <span className="es-rcard__placeholder">{event.title}</span>
          )}
          {when && (
            <span className="es-rcard__date">
              <b>{when.day}</b>
              <small>{when.month}</small>
            </span>
          )}
          {/* The soft white wave where the photo meets the card. */}
          <svg className="es-rcard__wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 22 C 90 6, 170 4, 250 16 S 360 30, 400 12 L 400 40 L 0 40 Z" className="es-rcard__wave-tint" />
            <path d="M0 28 C 100 12, 180 10, 260 22 S 360 34, 400 20 L 400 40 L 0 40 Z" className="es-rcard__wave-fill" />
          </svg>
        </div>

        <div className="es-rcard__body">
          <h3 className="es-rcard__title">{event.title}</h3>
          <p className="es-rcard__meta">
            {dateText && <span><NavIcon name="calendar" size={18} />{dateText}</span>}
            {dateText && place && <i aria-hidden="true" />}
            {place && <span className="fx-min0"><NavIcon name="pin" size={18} /><span className="fx-truncate">{place}</span></span>}
          </p>
          <div className="es-rcard__foot">
            <span className="es-rcard__tag">
              <CategoryIcon category={event.category} />
              {category}
            </span>
            <span className="es-rcard__go">
              {price && (
                <span className="es-rcard__price">
                  {price.label}
                  <b>{price.value}</b>
                </span>
              )}
              <span className="es-rcard__arrow" aria-hidden="true"><NavIcon name="arrow" size={18} /></span>
            </span>
          </div>
        </div>
      </Link>
      <SaveEventButton slug={event.slug} title={event.title} className="es-rcard__save" />
    </div>
  );
}

/** A music note for music, a tag for everything else. */
function CategoryIcon({ category }) {
  if (category === 'music' || category === 'concert' || category === 'concerts') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  return <NavIcon name="tag" size={16} />;
}
