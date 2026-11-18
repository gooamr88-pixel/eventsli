'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import BrandLoader from './brand/BrandLoader';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The logo animation, full screen, BETWEEN PAGES (owner, 2026-11-18: "between
 * moving between pages only and appear completely").
 *
 * WHEN IT SHOWS. A click on a link — or back/forward — to a DIFFERENT page
 * that loads its content from the database (DATA_PAGES, owner 2026-11-18).
 * A fixed-content page (How it works, Privacy, the sign-in forms) is on screen
 * almost at once, and a logo in front of it would be a wait we invented.
 * Not on the first load, not on images, and not when only the query or the
 * hash changes (filter tabs, in-page anchors) — those are the same page.
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
 * NOT ON THE GATE, though it fetches. `/gate` is the door scanner: a second
 * per screen there is a second per guest in the queue.
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
 * The pages that wait on the database, by prefix (each covers its subpages).
 * Checked 2026-11-18: these fetch on the server or through apiClient as they
 * open. Everything else — /how-it-works, /why-us, /trust, /contact, /privacy,
 * /sms-terms, /tickets/find (fetches only after its form is sent), the
 * sign-in and register pages — is fixed content. A new page that loads data
 * belongs here.
 */
const DATA_PAGES = [
  '/events',     // the listing, and the saved list
  '/e',          // an event, its seats, its tickets
  '/cart',
  '/checkout',
  '/t',          // a ticket (`/t/` only — not /terms or /trust)
  '/terms',      // the legal texts are served from the API
  '/account',
  '/organizer',
  '/admin',
];
export const isDataPage = (path) => path === '/'   // the homepage's events
  || DATA_PAGES.some((p) => path === p || path.startsWith(`${p}/`));

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
      // Same page — only the query or the hash differs.
      if (url.pathname === window.location.pathname) return;
      if (!isDataPage(url.pathname)) return;
      start();
    };
    // Back/forward: the URL has already changed; `st.path` is still the page
    // on screen.
    const onPop = () => {
      const next = window.location.pathname;
      if (next !== st.path && isDataPage(next)) start();
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
