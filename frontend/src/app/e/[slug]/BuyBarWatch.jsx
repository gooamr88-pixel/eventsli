'use client';

import { useEffect } from 'react';

/**
 * Hides the fixed buy bar while the section it points at is on screen
 * (owner, 2026-11-22). On a general-admission event the booking section has
 * its own total and buttons; the bar jumping to it while it is already in
 * view would be two sets of buttons, one over the other.
 *
 * Renders nothing. Works on `.es-buybar[data-watch]`, whose value is the id
 * of the section to watch; without one it does nothing at all.
 */
export default function BuyBarWatch() {
  useEffect(() => {
    const bar = document.querySelector('.es-buybar[data-watch]');
    const target = bar && document.getElementById(bar.getAttribute('data-watch'));
    if (!bar || !target || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      bar.toggleAttribute('data-away', entry.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return null;
}
