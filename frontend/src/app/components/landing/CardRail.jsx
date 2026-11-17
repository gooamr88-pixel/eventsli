'use client';

import { Children, useCallback, useEffect, useRef, useState } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ROW OF EVENT CARDS YOU CAN PAGE THROUGH — with dots (owner, 2026-11-17).
 *
 * From a tablet up, the homepage's event lists were a fixed grid that HID
 * every card after the sixth (`.es-lp-cards > li:nth-child(n + 7)`), so an
 * eighth event was fetched and never reachable. Now they are one row: three
 * cards across on a desktop, two on a tablet, scroll-snapped, with previous /
 * next and one dot per page underneath — the same short bars as the hero's VIP
 * slider, so the page has one way of saying "there is more".
 *
 * ON A PHONE NOTHING CHANGES: the two-column grid the owner asked for
 * (2026-11-15) has nothing to page through, so it has no controls. The
 * controls appear only when the row actually overflows — measured, not
 * guessed from a breakpoint — so a row of three on a desktop shows none.
 *
 * The cards stay plain links in a plain list: keyboard focus moving into a
 * card off to the side scrolls it into view, and the dots follow the scroll.
 * Smooth scrolling is skipped for anyone who asked for reduced motion.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CardRail({ children, label = 'Events', className = '' }) {
  const track = useRef(null);
  const count = Children.count(children);
  const [view, setView] = useState({ pages: 1, page: 0, perPage: count || 1 });

  const measure = useCallback(() => {
    const el = track.current;
    const first = el?.firstElementChild;
    if (!el || !first) return;
    const overflows = el.scrollWidth > el.clientWidth + 2;
    if (!overflows) {
      setView((v) => (v.pages === 1 && v.page === 0 ? v : { pages: 1, page: 0, perPage: count }));
      return;
    }
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const step = first.getBoundingClientRect().width + gap;
    const perPage = Math.max(1, Math.round((el.clientWidth + gap) / step));
    const pages = Math.max(1, Math.ceil(count / perPage));
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    const page = atEnd ? pages - 1 : Math.min(pages - 1, Math.round(el.scrollLeft / (step * perPage)));
    setView((v) => (v.pages === pages && v.page === page && v.perPage === perPage ? v : { pages, page, perPage }));
  }, [count]);

  useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // First measurement on the next frame, not in the effect body: layout has
    // settled by then, and no state is set synchronously here.
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [measure]);

  function goTo(page) {
    const el = track.current;
    const target = el?.children[Math.min(count - 1, Math.max(0, page) * view.perPage)];
    if (!el || !target) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target.offsetLeft - el.firstElementChild.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
  }

  const { pages, page, perPage } = view;
  return (
    <div className="es-rail">
      <ul ref={track} className={`es-lp-cards es-lp-rail ${className}`}>
        {children}
      </ul>

      {pages > 1 && (
        <div className="es-rail__nav">
          <button
            type="button" className="es-rail__arrow" onClick={() => goTo(page - 1)} disabled={page === 0}
            aria-label={`Previous ${label.toLowerCase()}`}
          >
            <NavIcon name="chevronLeft" size={20} />
          </button>
          <div className="es-rail__dots" role="group" aria-label={`${label}: choose a page`}>
            {Array.from({ length: pages }, (_, i) => {
              const from = i * perPage + 1;
              const to = Math.min(count, from + perPage - 1);
              return (
                <button
                  key={i} type="button" className="es-rail__dot" onClick={() => goTo(i)}
                  aria-current={i === page ? 'true' : undefined}
                  aria-label={from === to ? `Show event ${from} of ${count}` : `Show events ${from}–${to} of ${count}`}
                />
              );
            })}
          </div>
          <button
            type="button" className="es-rail__arrow" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}
            aria-label={`Next ${label.toLowerCase()}`}
          >
            <NavIcon name="chevronRight" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
