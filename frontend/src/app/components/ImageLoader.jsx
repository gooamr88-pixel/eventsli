'use client';

import { useEffect, useRef, useState } from 'react';
import BrandLoader from './brand/BrandLoader';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The logo animation over an image frame until its pictures arrive (owner,
 * 2026-11-18).
 *
 * DROP IT INTO A FRAME, AFTER THE IMAGES:
 *
 *   <div className="es-evcard__media">          ← positioned, sized
 *     <Image … fill />  <Image … fill />
 *     <ImageLoader />                            ← here
 *     <span className="badge">…</span>          ← stays above it
 *   </div>
 *
 * It covers the frame, watches every <img> in its parent element, and when all
 * of them have loaded (or failed) it fades out and removes itself — so no
 * looping animation is left running behind a finished picture. The images need
 * no wrapper and no onLoad prop, which keeps server components (EventCard)
 * server components.
 *
 * NO FLASH FOR A FAST IMAGE. The loader is invisible for its first 180ms
 * (CSS), and an image that is already complete when this mounts — a cached
 * cover, or one that finished before hydration — removes it at once.
 *
 * SMALL FRAMES get the card alone: a container query in globals.css swaps the
 * stacked lockup for the mark below 190px, where the word could not be read.
 * Off-screen frames pause their animation, so a listing of forty lazy covers is
 * not forty animations running below the fold.
 *
 * `tone="dark"` for frames on a dark ground (the VIP slider), where the word
 * turns white.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ImageLoader({ tone, className = '' }) {
  const ref = useRef(null);
  // 'wait' → 'out' (fading) → 'gone' (unmounted)
  const [phase, setPhase] = useState('wait');

  useEffect(() => {
    const node = ref.current;
    const frame = node?.parentElement;
    if (!frame) return undefined;

    const imgs = Array.from(frame.querySelectorAll('img'));
    const done = (img) => img.complete;
    if (imgs.length === 0 || imgs.every(done)) {
      // Next frame, not in the effect body (React 19 lint: no sync setState).
      const raf = requestAnimationFrame(() => setPhase('gone'));
      return () => cancelAnimationFrame(raf);
    }

    const check = () => { if (imgs.every(done)) setPhase('out'); };
    imgs.forEach((img) => {
      img.addEventListener('load', check);
      img.addEventListener('error', check);
    });

    let io;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([entry]) => {
        node.classList.toggle('is-paused', !entry.isIntersecting);
      });
      io.observe(node);
    }

    return () => {
      imgs.forEach((img) => {
        img.removeEventListener('load', check);
        img.removeEventListener('error', check);
      });
      io?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'out') return undefined;
    // Matches the fade in globals.css; a timer rather than transitionend so a
    // reduced-motion (zero-length) transition still unmounts.
    const t = setTimeout(() => setPhase('gone'), 420);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={`es-imgload ${tone === 'dark' ? 'es-imgload--dark' : ''} ${phase === 'out' ? 'is-done' : ''} ${className}`}
    >
      <BrandLoader className="es-imgload__full" />
      <BrandLoader variant="mark" className="es-imgload__mark" />
    </span>
  );
}
