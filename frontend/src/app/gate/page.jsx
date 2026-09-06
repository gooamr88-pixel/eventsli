import GateScanner from './GateScanner';

export const metadata = { title: 'Scan' };

/**
 * Rendered on the client from the first paint, deliberately.
 *
 * There is nothing to render on the server: the device token lives in
 * localStorage, the queue lives in IndexedDB, and both exist only in the
 * browser holding the tablet. A server render could produce exactly one thing —
 * the signed-out state — which would flash the sign-in screen on every reload
 * of a device that is signed in, at a door, mid-queue.
 *
 * This page used to declare `dynamic = 'force-static'` so the shell was cheap
 * and precacheable. It cannot any more: the CSP carries a per-request nonce and
 * a prerendered page has no way to know it (see config/csp.mjs). Nothing about
 * the door is worse for it — `gate-sw.js` caches whatever it fetched, header
 * and nonce together, so an offline reload serves a page whose inline scripts
 * still match the policy that came with it.
 */

export default function GatePage() {
  return <GateScanner />;
}
