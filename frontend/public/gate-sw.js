/* eslint-env serviceworker */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The gate's service worker.
 *
 * Its only job is that the door screen OPENS with no network. The queue of
 * scans lives in IndexedDB and needs no worker at all — but a queue you cannot
 * reach because the page will not load is a night's admissions locked inside a
 * tablet.
 *
 * THREE STRATEGIES, and which request gets which is the whole file:
 *
 *   navigations   → network first, cache second.
 *       The opposite would be a gate stuck on last week's build after a deploy,
 *       discovered at a door. The network is tried with a short timeout so a
 *       captive-portal wifi that accepts the connection and never answers falls
 *       through to the cache in two seconds instead of hanging.
 *
 *   /_next/static → cache first.
 *       Hashed filenames. The content at one of these URLs never changes, so
 *       revalidating it is a round trip that can only ever return the same
 *       bytes. This is what makes an offline reload actually render.
 *
 *   everything else same-origin → stale while revalidate.
 *       Fonts, the manifest, icons. Instant from cache, refreshed behind it.
 *
 * AND ONE HARD EXCLUSION: the API. Never cached, never intercepted, under any
 * strategy. A cached `POST /scan/verify` is meaningless (it is not a GET) but a
 * cached `GET /scan/status` would show a locked gate as open, or an admitted
 * count from an hour ago, and the operator would have no way to tell. Freshness
 * there is not a nicety — it is the difference between the door being right and
 * the door being confidently wrong.
 * ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = 'gate-v1';
const CACHE = `eventsli-${VERSION}`;

/** The two documents the gate is. Fetched at install so the very first offline
 *  reload has something to render, rather than only the second one. */
const SHELL = ['/gate', '/gate/login'];

const NAV_TIMEOUT_MS = 2000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, not `addAll`: addAll rejects as a unit, so one 404 during a
    // deploy would leave the worker with nothing cached at all.
    await Promise.all(SHELL.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok) await cache.put(url, response);
      } catch { /* offline at install — the runtime handlers will fill it in */ }
    }));
    // A door tablet is never closed and reopened to let a waiting worker take
    // over. Without this a fix ships and reaches the gate at the next reboot.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('eventsli-') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const network = await Promise.race([
      fetch(request),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('slow')), NAV_TIMEOUT_MS);
      }),
    ]);
    if (network && network.ok) cache.put(request, network.clone());
    return network;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    // Any gate document is better than the browser's error page: the operator
    // lands on a screen that can read the queue and tell them what is waiting.
    const shell = await cache.match('/gate');
    if (shell) return shell;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
      + '<body style="background:#09090b;color:#fafafa;font:16px system-ui;padding:32px">'
      + '<h1>No connection</h1><p>The gate has not been opened on this device yet, '
      + 'so there is nothing stored to show. Reconnect once and it will work offline '
      + 'from then on.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const network = await fetch(request);
  if (network.ok) cache.put(request, network.clone());
  return network;
}

async function fromCacheThenUpdate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return hit || update.then((r) => r || Response.error());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A POST is never cacheable and must never be delayed by this file. Every
  // scan is a POST.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // the API, in production
  if (isApi(url)) return;                            // the API, same-origin

  if (request.mode === 'navigate') {
    event.respondWith(fromNetworkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(fromCacheFirst(request));
    return;
  }

  event.respondWith(fromCacheThenUpdate(request));
});
