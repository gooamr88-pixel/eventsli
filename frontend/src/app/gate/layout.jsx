import GateServiceWorker from './GateServiceWorker';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The gate is a route, not a second application.
 *
 * The previous platform shipped a whole Flutter app for this — `gatekeeper_app/`,
 * with an Android build, an iOS build, a bloc layer and its own Supabase
 * credentials. Every rule at the door then existed twice, and the copy on the
 * tablet was the one nobody updated. Here the door and the storefront share the
 * API, the error table, the money rules and the deploy.
 *
 * What it does NOT share is NAVIGATION. `SiteHeader` returns null under /gate
 * and `proxy.ts` exempts the whole prefix, because the gate's principal is a
 * device with a PIN — a staff session cookie must not open it, and its absence
 * must not redirect somebody to a page asking for an email address.
 *
 * It DOES share the brand, which it did not until 2026-10-12. "No site header"
 * had been read as "no identity", so the door was the one screen in the product
 * with no logo, no blue and none of the type the rest of it is set in — on the
 * surface a guest leans over and reads. `GateHead` is the masthead without the
 * navigation: the mark, the wordmark, and nothing to tap.
 *
 * The manifest is served from /public and linked HERE rather than from
 * `app/manifest.js`, which is the Next convention. The convention emits one
 * manifest for the whole site, linked into every page's head — so a visitor
 * browsing events would be offered "install Eventsli Gate". The installable
 * thing is this subtree, so the link belongs to this subtree.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'Gate',
  manifest: '/gate.webmanifest',
  // Nothing here is public and nothing here is useful in a search result. A
  // crawler that indexed it would be publishing the address of the door.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport = {
  /**
   * THE BRAND TEAL (#0D5B5E, the guide's value), not the old near-black.
   *
   * The gate used to pin the dark palette and told the browser furniture the
   * same thing. It follows the site now (see `.fx-gate` in globals.css), so an
   * address bar left at #09090b would be the one black band on an otherwise
   * white screen — the exact mismatch this value exists to prevent, pointing
   * the other way.
   *
   * A plain string rather than the root layout's light/dark pair: the gate has
   * one appearance and does not follow the device, so offering the browser a
   * choice would be describing a screen that cannot happen.
   */
  themeColor: '#0d5b5e',
  width: 'device-width',
  initialScale: 1,
  /**
   * ZOOM STAYS ENABLED. This carried `maximumScale: 1, userScalable: false`
   * with the reasoning that a pinch-zoomed camera viewport is a scan that
   * misses. That reasoning does not survive contact with the trade:
   *
   *   · It is a WCAG 1.4.4 failure — Lighthouse flags it — and it lands on
   *     exactly the person who needs to magnify a small screen in the dark.
   *   · iOS has ignored `user-scalable=no` since Safari 10, so it never
   *     applied on half the tablets in question anyway.
   *   · The cost it prevents is one accidental pinch, undone by another.
   *
   * `viewportFit: cover` stays: it is what makes env(safe-area-inset-*)
   * report anything other than zero, and without it the action bar sits under
   * the home indicator.
   */
  viewportFit: 'cover',
};

export default function GateLayout({ children }) {
  return (
    <div className="fx-gate fx-safe-inset">
      <GateServiceWorker />
      {children}
    </div>
  );
}
