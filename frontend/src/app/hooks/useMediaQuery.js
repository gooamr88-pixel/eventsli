'use client';

import { useSyncExternalStore } from 'react';
import { BREAKPOINTS, up, down, between, COARSE_POINTER, REDUCED_MOTION } from '../lib/breakpoints';

/**
 * SSR-safe media-query hooks, over the four breakpoints in lib/breakpoints.js.
 *
 * `useSyncExternalStore` rather than useState + useEffect, for two reasons that
 * both matter here: it returns the correct value on the FIRST client render
 * instead of painting the desktop layout and then correcting it, and a setState
 * inside a mount effect is a lint failure in this project.
 */

/**
 * One cached store per query string.
 *
 * This cache is the CONTRACT, not an optimisation. useSyncExternalStore
 * re-subscribes whenever the `subscribe` function identity changes, so inlining
 * the closure would tear down and re-add a matchMedia listener on every render,
 * on every route that uses one of these hooks. Nothing errors and nothing warns
 * — the listener count just climbs. Do not simplify this away.
 */
const stores = new Map();

function getStore(query) {
  let store = stores.get(query);
  if (!store) {
    store = {
      subscribe(callback) {
        // Guards the server, and any environment without matchMedia — jsdom
        // without a polyfill, which is what the test suite runs in. A no-op
        // unsubscribe keeps useSyncExternalStore happy.
        if (typeof window === 'undefined' || !window.matchMedia) return () => {};
        const mq = window.matchMedia(query);
        mq.addEventListener('change', callback);
        return () => mq.removeEventListener('change', callback);
      },
      getSnapshot() {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(query).matches;
      },
    };
    stores.set(query, store);
  }
  return store;
}

/**
 * The server snapshot is always `false`, so the server render and the first
 * client render agree and there is no hydration mismatch. Write components so
 * `false` is the safe branch. If a layout genuinely cannot render server-side,
 * gate on the value rather than inverting the default.
 */
export function useMediaQuery(query) {
  const store = getStore(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => false);
}

/** `>= bp` — Tailwind's `lg:` in JavaScript. */
export function useBreakpointUp(bp) { return useMediaQuery(up(bp)); }

/** `< bp` */
export function useBreakpointDown(bp) { return useMediaQuery(down(bp)); }

/** `>= a and < b` */
export function useBreakpointBetween(a, b) { return useMediaQuery(between(a, b)); }

/** Narrower than md (768px) — phones and small tablets. */
export function useIsMobile() { return useBreakpointDown('md'); }

/** Between md (768px) and lg (1024px). */
export function useIsTablet() { return useBreakpointBetween('md', 'lg'); }

/** lg (1024px) and up. */
export function useIsDesktop() { return useBreakpointUp('lg'); }

/**
 * Touch-primary, regardless of width.
 *
 * The seat map is the reason this is separate from the width hooks. Whether to
 * render drag-to-pan or click-to-select, and how large a seat's hit area has to
 * be, is a question about the POINTER — a 900px phone in landscape is still a
 * thumb. Use the width hooks for layout, this one for interaction.
 */
export function useIsTouch() { return useMediaQuery(COARSE_POINTER); }

export function usePrefersReducedMotion() { return useMediaQuery(REDUCED_MOTION); }

export { BREAKPOINTS };
