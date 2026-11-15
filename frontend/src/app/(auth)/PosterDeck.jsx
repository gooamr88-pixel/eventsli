'use client';

import { useEffect, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The auth panel's posters, as a deck that shuffles (owner, 2026-11-15:
 * "make it very professional and dynamic").
 *
 * Real VIP event posters in three slots — one in front, larger, with the
 * deepest shadow; one tilted behind on each side. Every few seconds the deck
 * turns: the front poster slides to the side and the next one comes forward.
 * Every move is a CSS transition on `transform`, so it runs on the compositor
 * and the browser animates all three posters together. The whole deck also
 * floats, slowly, so the panel is never a still photograph.
 *
 * It stops while the pointer is over it, while the tab is hidden, and for a
 * visitor whose system asks for reduced motion it never starts. Decorative:
 * the panel is `aria-hidden`, and nothing here is focusable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const INTERVAL = 3500;

export default function PosterDeck({ posters = [] }) {
  const n = posters.length;
  const [front, setFront] = useState(0);
  const [held, setHeld] = useState(false);
  const [still, setStill] = useState(true);   // until the effect has read the preference

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(mq.matches || document.hidden);
    const t = setTimeout(sync, 0);
    mq.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearTimeout(t);
      mq.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const running = n > 1 && !held && !still;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => setFront((f) => (f + 1) % n), INTERVAL);
    return () => clearTimeout(timer);
  }, [running, front, n]);

  if (n === 0) return null;

  return (
    <div
      className={`es-deck es-deck--${n} ${still ? '' : 'is-floating'}`}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      {posters.map((p, i) => {
        // 0 = front, 1 = right, 2 = left (a deck of two uses front and right).
        const slot = (i - front + n) % n;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- decorative posters straight from storage
          <img
            key={p.id}
            src={p.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="es-deck__card"
            data-slot={slot}
          />
        );
      })}
    </div>
  );
}
