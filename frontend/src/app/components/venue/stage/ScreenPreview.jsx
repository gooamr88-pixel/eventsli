'use client';

import { useEffect, useRef } from 'react';
import { createScreenPainter } from './screenPainter';
import { DEFAULT_SCREEN } from './screenModel';

/**
 * The stage screen, flat: the same painter the 3D room's LED wall uses, at
 * 16:9 in the settings panel, so an organizer reads every slide's words at a
 * size they can check while they type them. A tap moves to the next slide,
 * exactly as a tap on the screen in the room does.
 *
 * It repaints at 24 fps while it is on the page (once a second under reduced
 * motion) and stops when it is not: the browser pauses the frames of a hidden
 * tab, and unmounting cancels them.
 */
export default function ScreenPreview({ screen, feed, title, className = '' }) {
  const hostRef = useRef(null);
  const painterRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const painter = createScreenPainter({ width: 960 });
    const still = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    painter.setStill(still);
    painter.canvas.className = 'es-screenprev__canvas';
    painter.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(painter.canvas);
    painterRef.current = painter;
    let frame = 0;
    let next = 0;
    const loop = (now) => {
      if (now >= next) {
        next = now + (still ? 1000 : 1000 / 24);
        painter.paint(now, null);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      painter.canvas.remove();
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  useEffect(() => {
    painterRef.current?.setContent({ screen: screen || DEFAULT_SCREEN, feed, title });
  }, [screen, feed, title]);

  return (
    <button
      type="button" ref={hostRef} className={`es-screenprev ${className}`.trim()}
      onClick={() => painterRef.current?.skip()}
      aria-label="Stage screen preview. Press for the next slide."
      title="Next slide"
    />
  );
}
