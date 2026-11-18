'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import BrandLoader from './brand/BrandLoader';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The logo animation, full screen, BETWEEN PAGES (owner, 2026-11-18: "between
 * moving between pages only and appear completely").
 *
 * WHEN IT SHOWS. A click on a link — or back/forward — to one of the three
 * storefront pages in TRANSITION_PAGES (owner 2026-11-18: "not for all pages
 * of database — the suitable ones"). Not on the first load, not on images,
 * and not when only the query or the hash changes (filter tabs, in-page
 * anchors) — those are the same page.
 *
 * IT PLAYS COMPLETELY. The overlay stays until BOTH the animation has run to
 * the finished logo (HOLD_MS) AND the new page has arrived (the pathname
 * changed). A fast page waits for the logo; a slow page keeps the finished
 * logo up, breathing, until it lands. Then one fade out.
 *
 * WHY A DOCUMENT CLICK LISTENER and not router events: the App Router has
 * none. Every <Link> renders a real <a href>, so one listener sees them all.
 * `defaultPrevented` cannot be used to filter — <Link> prevents the default
 * itself, before this listener runs. Programmatic `router.push()` (after a
 * form submits) is not covered; those already show their own busy state.
 *
 * A link that turns out not to navigate (a handler cancelled it) would leave
 * the overlay up, so GIVE_UP_MS takes it down regardless.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The spark settles at 64% of the 1.2s run (globals.css `--es-bl-run`).
 *  About a second end to end, fade included — 2.5s was "very slow". */
const HOLD_MS = 850;
const REDUCED_HOLD_MS = 300;
const OUT_MS = 220;
const GIVE_UP_MS = 12000;

/**
 * WHICH PAGES. The storefront's discovery path, where the server fetches
 * before anything shows and a brand moment suits the jump:
 *
 *   /           the homepage, with its events
 *   /events     the listing (not /events/saved — a small list of your own)
 *   /e/<slug>   an event's page (not its /seats or /tickets steps)
 *
 * Deliberately NOT, though they load data (chosen 2026-11-18):
 *   · the purchase steps — seats, tickets, cart, checkout: the buyer is mid
 *     purchase, those screens have their own loading shapes, and a logo
 *     there reads as a delay at the worst moment
 *   · the dashboards (organizer, admin, account): worked in all day, and
 *     they have their own skeletons — "not suitable between sections"
 *   · a ticket, the terms, every fixed-content page (How it works, Privacy,
 *     sign-in) — on screen at once, nothing to cover
 *   · the door scanner, where a second per screen is a second per guest
 */
export const isTransitionPage = (path) => path === '/' || path === '/events' || /^\/e\/[^/]+$/.test(path);

const eventOf = (path) => path.match(/^\/e\/([^/]+)/)?.[1] || null;

/** Does moving from `from` to `to` get the transition? */
export function showsTransition(from, to) {
  if (!to || to === from) return false;
  if (!isTransitionPage(to)) return false;
  // Back to an event's page from its own seats or tickets step: the same
  // event, already loaded — no logo.
  const ev = eventOf(to);
  if (ev && ev === eventOf(from || '')) return false;
  return true;
}

export default function PageTransition() {
  const pathname = usePathname();
  // null when idle; otherwise which run, and whether it is playing, waiting
  // on the page, or fading out.
  const [run, setRun] = useState(null);
  const ctl = useRef({ id: 0, active: false, logoDone: false, routeDone: false, timers: [], path: null, arrived: null });

  useEffect(() => {
    const st = ctl.current;
    const later = (fn, ms) => st.timers.push(setTimeout(fn, ms));
    const clearAll = () => { st.timers.forEach(clearTimeout); st.timers = []; };

    const finish = () => {
      clearAll();
      setRun((r) => (r ? { ...r, phase: 'out' } : r));
      later(() => { st.active = false; setRun(null); }, OUT_MS);
    };
    const maybeFinish = () => { if (st.active && st.logoDone && st.routeDone) finish(); };

    const start = () => {
      if (st.active) return;
      clearAll();
      st.active = true;
      st.logoDone = false;
      st.routeDone = false;
      st.id += 1;
      setRun({ id: st.id, phase: 'play' });
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      later(() => {
        st.logoDone = true;
        if (!st.routeDone) setRun((r) => (r && r.phase === 'play' ? { ...r, phase: 'wait' } : r));
        maybeFinish();
      }, reduced ? REDUCED_HOLD_MS : HOLD_MS);
      later(() => { st.logoDone = true; st.routeDone = true; maybeFinish(); }, GIVE_UP_MS);
    };
    st.arrived = () => { if (st.active) { st.routeDone = true; maybeFinish(); } };

    const onClick = (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!a) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      // Same page (only the query or hash differs), a fixed-content page, or
      // a hop between dashboard sections: no transition.
      if (!showsTransition(window.location.pathname, url.pathname)) return;
      start();
    };
    // Back/forward: the URL has already changed; `st.path` is still the page
    // on screen.
    const onPop = () => {
      const next = window.location.pathname;
      if (showsTransition(st.path || '', next)) start();
    };

    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
      clearAll();
    };
  }, []);

  // The new page is on screen.
  useEffect(() => {
    ctl.current.path = pathname;
    ctl.current.arrived?.();
  }, [pathname]);

  if (!run) return null;

  return (
    <div
      key={run.id}
      role="status"
      aria-live="polite"
      className={`es-pagefx ${run.phase === 'wait' ? 'is-waiting' : ''} ${run.phase === 'out' ? 'is-out' : ''}`}
    >
      <BrandLoader className="es-pagefx__logo" />
      <span className="sr-only">Loading the page</span>
    </div>
  );
}
