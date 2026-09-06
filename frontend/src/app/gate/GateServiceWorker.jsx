'use client';

import { useEffect } from 'react';

/**
 * Registers the gate's service worker, and only the gate's.
 *
 * WHY THERE IS ONE AT ALL. The offline queue in IndexedDB is worth nothing if
 * the page that reads it will not load. A tablet at a venue loses signal, the
 * browser is killed to reclaim memory, somebody taps reload — and without a
 * service worker that is a dinosaur on a screen with three hundred people
 * outside and a night's admissions sitting in a database nobody can open.
 *
 * WHY THE SCOPE IS `/gate`. A worker registered at the origin root would
 * intercept the storefront and the checkout too. Scope decides which PAGES the
 * worker controls; a controlled page's subresource requests all go through it
 * regardless of their path, so `/gate` still covers the `/_next/static` chunks
 * the gate needs. Nothing outside this subtree is touched, and a caching bug
 * here can never serve a stale checkout.
 *
 * WHY IT IS NOT REGISTERED IN DEVELOPMENT. A service worker outlives the dev
 * server: it keeps serving a cached build after a code change, and the usual
 * next move is an hour of debugging a file that is already correct on disk.
 */
export default function GateServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/gate-sw.js', { scope: '/gate' })
      .catch(() => {
        // Nothing to say and nothing to do. Offline shell caching is an
        // improvement on the gate, not a requirement of it — the queue itself
        // is IndexedDB and works with no worker at all.
      });
  }, []);

  return null;
}
