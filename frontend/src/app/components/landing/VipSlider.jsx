'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import NavIcon from '../shell/NavIcon';
import { eventDateParts, priceBlock, ctaLabel } from '../EventCard';
import { isDateOnly, formatDateOnly } from '../../lib/dateOnly';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's slider: the VIP events an admin chose (2026-11-15).
 *
 * Replaces the photo collage, which the owner called "very terrible". The
 * events come from `/public/vip-events` in the admin's order; when none are
 * chosen the API sends the soonest upcoming events instead, and the VIP badge
 * is drawn only on `vip: true` — never on an event nobody picked.
 *
 * THE MOTION. The current slide sits in the middle; its neighbours peek in at
 * each side, smaller and dimmed. Every slide is positioned by its OFFSET from
 * the current one (`data-pos`), and CSS transitions the transform — so moving
 * left or right is one state change and the browser animates every slide at
 * once, on the compositor, with no layout per frame.
 *
 * AUTOPLAY, AND HOW IT STOPS (WCAG 2.2.2): it advances every 5.5s, and pauses
 * while the pointer is over the slider, while focus is inside it, while the tab
 * is hidden, and for good once the visitor presses pause. A visitor whose
 * system asks for reduced motion gets no autoplay at all — the arrows, the
 * dots and a swipe still work.
 *
 * ONLY THE CURRENT SLIDE IS A LINK in the tab order; the peeking ones are
 * buttons that bring themselves to the middle, hidden from assistive tech so a
 * screen reader hears one event at a time with "2 of 5" beside it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const INTERVAL = 5500;

export default function VipSlider({ events = [] }) {
  const n = events.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);      // the visitor pressed pause
  const [held, setHeld] = useState(false);          // hover or focus inside
  const [hidden, setHidden] = useState(false);      // the tab is not visible
  const [calm, setCalm] = useState(false);          // prefers-reduced-motion
  const swipe = useRef(null);

  const go = useCallback((to) => setActive(((to % n) + n) % n), [n]);
  const next = useCallback(() => setActive((a) => (a + 1) % n), [n]);
  const prev = useCallback(() => setActive((a) => (a - 1 + n) % n), [n]);

  // The system's motion preference, and the tab's visibility. Both read in an
  // effect and set from their own listeners — never synchronously in the body.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setCalm(mq.matches);
    const onVisible = () => setHidden(document.hidden);
    const t = setTimeout(() => { onMotion(); onVisible(); }, 0);
    mq.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      mq.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const running = n > 1 && !paused && !held && !hidden && !calm;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(next, INTERVAL);
    return () => clearTimeout(timer);
  }, [running, active, next]);

  if (n === 0) return null;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  };
  const onPointerDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      if (dx < 0) next(); else prev();
    }
  };

  return (
    <section
      className="es-vip"
      aria-roledescription="carousel"
      aria-label="VIP events"
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}
    >
      <div
        className="es-vip__stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { swipe.current = null; }}
      >
        {events.map((event, i) => {
          let pos = (i - active + n) % n;
          if (pos > n / 2) pos -= n;
          return (
            <Slide
              key={event.id}
              event={event}
              pos={pos}
              index={i}
              total={n}
              eager={i === 0}
              onSelect={() => go(i)}
            />
          );
        })}

        {n > 1 && (
          <>
            <button type="button" className="es-vip__arrow es-vip__arrow--prev" onClick={prev} aria-label="Previous event">
              <NavIcon name="chevronLeft" size={22} />
            </button>
            <button type="button" className="es-vip__arrow es-vip__arrow--next" onClick={next} aria-label="Next event">
              <NavIcon name="chevronRight" size={22} />
            </button>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="es-vip__controls">
          <div className="es-vip__dots" role="group" aria-label="Choose an event">
            {events.map((event, i) => (
              <button
                key={event.id}
                type="button"
                className="es-vip__dot"
                aria-label={`${i + 1} of ${n}: ${event.title}`}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => go(i)}
              >
                {/* The fill runs for exactly one interval; keyed on `active` so
                    it restarts with every slide, and frozen while paused. */}
                {i === active && (
                  <span
                    key={active}
                    className="es-vip__fill"
                    style={{ animationDuration: `${INTERVAL}ms`, animationPlayState: running ? 'running' : 'paused' }}
                  />
                )}
              </button>
            ))}
          </div>
          {!calm && (
            <button
              type="button"
              className="es-vip__pause"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Play the slideshow' : 'Pause the slideshow'}
            >
              <NavIcon name={paused ? 'play' : 'pause'} size={16} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Slide({ event, pos, index, total, eager, onSelect }) {
  const current = pos === 0;
  const when = eventDateParts(event);
  const price = priceBlock(event);
  const date = when
    ? (isDateOnly(event) ? formatDateOnly(event, { style: 'short' }) : `${when.weekday}, ${when.month} ${Number(when.day)} · ${when.time}`)
    : '';
  const place = [event.venue, event.city].filter(Boolean).join(', ');

  return (
    <article
      className="es-vip__slide"
      data-pos={Math.max(-2, Math.min(2, pos))}
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
      aria-hidden={current ? undefined : true}
    >
      <div className="es-vip__media">
        {event.coverUrl ? (
          // A plain <img> straight from storage, as the hero always did: the
          // file is uploaded already encoded.
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img
            src={event.coverUrl}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : 'auto'}
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="es-vip__placeholder">{event.title}</span>
        )}
      </div>

      <div className="es-vip__info">
        {event.vip && (
          <span className="es-vip__badge">
            <NavIcon name="crown" size={14} />
            VIP
          </span>
        )}
        <h3 className="es-vip__title">{event.title}</h3>
        {(date || place) && (
          <p className="es-vip__meta">
            {date && <span>{date}</span>}
            {place && <span className="fx-truncate">{place}</span>}
          </p>
        )}
        <div className="es-vip__foot">
          {price && (
            <span className="es-vip__price">{price.label} <b>{price.value}</b></span>
          )}
          <span className="es-vip__cta" aria-hidden>
            {ctaLabel(event)}
            <NavIcon name="arrow" size={16} />
          </span>
        </div>
      </div>

      {current ? (
        <Link href={`/e/${event.slug}`} className="es-vip__link">
          <span className="sr-only">{event.title}{date ? `, ${date}` : ''}. {ctaLabel(event)}</span>
        </Link>
      ) : (
        <button type="button" className="es-vip__link" tabIndex={-1} onClick={onSelect}>
          <span className="sr-only">Show {event.title}</span>
        </button>
      )}
    </article>
  );
}
