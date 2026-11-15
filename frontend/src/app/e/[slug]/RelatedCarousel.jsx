'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';
import EventCard from '../../components/EventCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "You might also like" — the owner's design (2026-11-10, image 2).
 *
 * A carousel of wide cards: neighbours peek in at the edges, a white arrow
 * steps back and a coral one steps on, and a dot per card says where you are.
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
        <div className="es-related__actions">
        <Link href={moreHref} className="es-related__more">
          <NavIcon name="pin" size={20} />
          <span>{city ? `All events in ${city}` : 'All events'}</span>
          <NavIcon name="arrow" size={20} />
        </Link>
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
      </div>

      <div className="es-related__frame">
        <ul ref={trackRef} className="es-related__track">
          {events.map((event) => <li key={event.id} className="es-related__item"><EventCard event={event} /></li>)}
        </ul>
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
