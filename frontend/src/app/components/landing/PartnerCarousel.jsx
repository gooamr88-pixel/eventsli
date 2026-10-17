'use client';

import { useEffect, useRef } from 'react';
import NavIcon from '../shell/NavIcon';

/** Pixels per second. Slow enough to read every logo as it passes. */
const SPEED = 36;
/** A set shorter than the card would leave a gap in the loop, so a short
 *  sponsor list is repeated until one set holds at least this many tiles. */
const MIN_TILES = 8;
/** How long a hand-off (arrow, drag) waits before the glide picks up again. */
const RESUME_MS = 2200;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The partner logos, gliding sideways without end, an arrow at each side and
 * a progress bar beneath. Two looks, one behaviour:
 *
 *   card   one white card with dividers — the foot of the hero
 *   tiles  a white tile per logo — the partners band above the footer
 *
 * 2026-10-17, owner: "make sponsor logos move professionally, on mobile and
 * desktop". It is ONE loop driven by requestAnimationFrame on a transform,
 * rather than a CSS keyframe, because the arrows and a finger have to be able
 * to take it over mid-glide and hand it back from exactly where they left it.
 *
 * ── The loop ────────────────────────────────────────────────────────────────
 * The set is rendered twice and the offset wraps at one set's width, so the
 * seam is never seen. The second copy (and any repeat inside the first) is
 * `aria-hidden` — a screen reader hears each sponsor once.
 *
 * ── When it stands still ───────────────────────────────────────────────────
 * Under a mouse, while a keyboard user is on an arrow, while off screen, and
 * always under `prefers-reduced-motion` — there the arrows still step it.
 *
 * Every tile is a real, admin-published sponsor; the page does not render this
 * at all until there is one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PartnerCarousel({ label, sponsors, heading = true, variant = 'card' }) {
  const viewport = useRef(null);
  const track = useRef(null);
  const bar = useRef(null);
  const ctl = useRef({ offset: 0, tween: null, drag: null, hover: false, focus: false, resumeAt: 0 });

  const repeats = Math.max(1, Math.ceil(MIN_TILES / sponsors.length));
  const set = Array.from({ length: repeats }, () => sponsors).flat();

  useEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    if (!vp || !tr) return undefined;
    const c = ctl.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');

    let setWidth = 0;
    const measure = () => { setWidth = tr.scrollWidth / 2; };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(tr);

    let visible = true;
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    seen.observe(vp);

    const paint = () => {
      if (!setWidth) return;
      const x = ((c.offset % setWidth) + setWidth) % setWidth;
      tr.style.transform = `translate3d(${-x}px, 0, 0)`;
      if (bar.current) {
        const size = Math.min(100, (vp.clientWidth / setWidth) * 100);
        bar.current.style.width = `${size}%`;
        bar.current.style.left = `${(x / setWidth) * (100 - size)}%`;
      }
    };

    let last = performance.now();
    let frame = 0;
    const tick = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (c.tween) {
        const p = Math.min(1, (now - c.tween.start) / c.tween.duration);
        const eased = 1 - (1 - p) ** 3;
        c.offset = c.tween.from + (c.tween.to - c.tween.from) * eased;
        if (p === 1) { c.tween = null; c.resumeAt = now + RESUME_MS; }
      } else if (!c.drag && !c.hover && !c.focus && visible && !still.matches && now >= c.resumeAt) {
        c.offset += (SPEED * dt) / 1000;
      }
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // The arrows: one tile along, eased; instant under reduced motion.
    c.step = (dir) => {
      const tile = tr.firstElementChild?.getBoundingClientRect().width || 160;
      const from = c.offset;
      c.tween = { from, to: from + dir * tile, start: performance.now(), duration: still.matches ? 0 : 520 };
    };

    // A mouse resting on the card pauses it; a touch does not count as hover.
    const enter = (e) => { if (e.pointerType === 'mouse') c.hover = true; };
    const leave = (e) => { if (e.pointerType === 'mouse') c.hover = false; };
    // Keyboard focus only — a mouse click also focuses the arrow, and that
    // must not freeze the glide until the visitor clicks somewhere else.
    const focusIn = (e) => { c.focus = e.target.matches(':focus-visible'); };
    const focusOut = () => { c.focus = false; };

    // Dragging, by finger or mouse. `touch-action: pan-y` in the CSS keeps a
    // vertical swipe scrolling the page.
    const down = (e) => {
      if (e.button > 0) return;
      c.tween = null;
      c.drag = { x: e.clientX, from: c.offset, id: e.pointerId };
      vp.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!c.drag || e.pointerId !== c.drag.id) return;
      c.offset = c.drag.from - (e.clientX - c.drag.x);
    };
    const up = (e) => {
      if (!c.drag || e.pointerId !== c.drag.id) return;
      c.drag = null;
      c.resumeAt = performance.now() + RESUME_MS;
    };

    const frameEl = vp.parentElement;
    frameEl.addEventListener('pointerenter', enter);
    frameEl.addEventListener('pointerleave', leave);
    frameEl.addEventListener('focusin', focusIn);
    frameEl.addEventListener('focusout', focusOut);
    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      frameEl.removeEventListener('pointerenter', enter);
      frameEl.removeEventListener('pointerleave', leave);
      frameEl.removeEventListener('focusin', focusIn);
      frameEl.removeEventListener('focusout', focusOut);
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', up);
    };
  }, [sponsors]);

  const step = (dir) => ctl.current.step?.(dir);

  return (
    <div className={`es-lp-partners es-lp-partners--${variant}`}>
      {heading && <p className="es-lp-partners__label">{label}</p>}

      <div className="es-lp-partners__frame">
        <button type="button" className="es-lp-partners__nav es-lp-partners__nav--prev" onClick={() => step(-1)} aria-label="Previous partners">
          <NavIcon name="chevronLeft" size={20} />
        </button>

        <div ref={viewport} className="es-lp-partners__viewport">
          <ul ref={track} className="es-lp-partners__track" aria-label={label}>
            {[0, 1].map((copy) => set.map((sponsor, i) => {
              const hidden = copy > 0 || i >= sponsors.length;
              return (
                <li key={`${copy}-${i}-${sponsor.id}`} aria-hidden={hidden || undefined} className="es-lp-partners__item">
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      sponsor logos are frequently SVG and have no intrinsic
                      dimensions we could give next/image without inventing them. */}
                  <img src={sponsor.logoUrl} alt={hidden ? '' : sponsor.name} decoding="async" draggable={false} className="es-lp-partners__mark" />
                </li>
              );
            }))}
          </ul>
        </div>

        <button type="button" className="es-lp-partners__nav es-lp-partners__nav--next" onClick={() => step(1)} aria-label="Next partners">
          <NavIcon name="chevronRight" size={20} />
        </button>
      </div>

      <div aria-hidden className="es-lp-partners__progress"><i ref={bar} /></div>
    </div>
  );
}
