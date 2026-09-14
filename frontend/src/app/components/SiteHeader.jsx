'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, signOut } from '../hooks/useAuth';

/**
 * The masthead.
 *
 * A CLIENT component, but it does not make any page dynamic: the pages around
 * it still render and cache on the server, and this hydrates and asks
 * `/auth/me` once. Reading the session in the layout instead would opt every
 * page out of static rendering — including the event pages, which are the ones
 * that must be cached and crawlable.
 *
 * While the answer is in flight the auth slot renders NOTHING rather than
 * guessing. Guessing "signed out" and correcting a moment later is a flicker
 * that every signed-in person sees on every page.
 */
/**
 * The gate is a device, not a person, and it runs full-screen on a tablet at a
 * door. A site nav on it is chrome someone can tap by accident mid-queue.
 *
 * The check is in a WRAPPER, above the component that calls `useAuth`, and that
 * is the point. Returning null after the hook still runs it — so the gate was
 * asking `/auth/me` on every load, getting a 401 it never used, and logging an
 * error to the console of a tablet that may have no signal at all. Hooks cannot
 * be skipped; components can.
 */
/**
 * The organizer dashboard and the admin console are the other two: each has
 * its own shell with a sidebar pinned to the top of the viewport, and a sticky
 * site header above it would sit on top of the sidebar's brand and first items.
 */
export const APP_SHELL_PREFIXES = ['/gate', '/organizer', '/admin'];

export function inAppShell(pathname) {
  return APP_SHELL_PREFIXES.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
}

export default function SiteHeader() {
  const pathname = usePathname();
  if (inAppShell(pathname)) return null;
  return <SiteNav pathname={pathname} />;
}

function SiteNav({ pathname }) {
  const { signedIn, loading, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * Close the menu when the route changes.
   *
   * Without this, tapping a link navigates and leaves the panel sitting open
   * over the page that just loaded — the single most common bug in a
   * hand-rolled mobile nav, because in development the transition is instant
   * and it looks like the menu simply closed.
   *
   * ADJUSTED DURING RENDER, not in an effect, and the difference is visible to
   * the user. `useEffect(() => setMenuOpen(false), [pathname])` runs AFTER the
   * browser has painted, so the new page is drawn once with the old page's
   * menu still over it and then again without — a flash on every navigation,
   * on the slowest devices the ones most likely to see it. React re-runs this
   * component before committing anything, so nothing with the stale value ever
   * reaches the screen. It is also what `react-hooks/set-state-in-effect`
   * exists to push you towards.
   *
   * An onClick on each link would close it too, but only for a tap — it would
   * miss the back button, which is exactly how someone leaves a page they
   * opened from this menu.
   */
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  /**
   * Escape closes it.
   *
   * Bound only while the menu is open, so there is no listener on the window
   * for the 99% of the time it is shut. WCAG 2.1.2: a thing that traps
   * attention has to be dismissible from the keyboard.
   */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const links = navLinks({ signedIn, loading, user, pathname });

  return (
    <header className="sticky top-0 z-[--es-z-navbar] border-b border-border-base bg-bg/85 backdrop-blur">
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl">
          <div className="fx-row fx-row--between h-16">
            <Link
              href="/"
              className="fx-touch font-serif text-xl tracking-[-0.02em] text-ink"
            >
              Eventsli
            </Link>

            {/* ── Desktop ────────────────────────────────────────────
                One nav element, two renderings. The links come from the
                same `navLinks()` call, so the phone can never be offered a
                different set from the desktop — which is how "Find my
                tickets" goes missing on mobile and nobody notices for a
                month. */}
            <nav className="fx-hide-below-md fx-row" aria-label="Main">
              {links.map((link) => (
                <NavLink key={link.href} link={link} pathname={pathname} />
              ))}
              {signedIn && (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="es-btn es-btn--secondary es-btn--sm"
                >
                  Sign out
                </button>
              )}
            </nav>

            {/* ── The phone's button ─────────────────────────────────
                `aria-expanded` and `aria-controls` are not decoration: they
                are the only thing that tells a screen reader this button
                owns a panel and whether the panel is open. A bare button
                announces as "Menu, button" and gives no way to know that
                pressing it did anything. */}
            <button
              type="button"
              className="es-btn es-btn--ghost fx-touch--icon fx-only-below-md"
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Burger open={menuOpen} />
            </button>
          </div>
        </div>
      </div>

      {/* ── The phone's panel ──────────────────────────────────────────
          Rendered only when open, rather than hidden with a class. A menu
          that is always in the DOM is always in the tab order unless every
          link inside it is also given `tabindex="-1"` and kept in sync —
          which is a second source of truth for the same state. Unmounting
          is one source. */}
      {menuOpen && (
        <nav
          id="site-menu"
          aria-label="Main"
          className="fx-only-below-md border-t border-border-base bg-surface"
        >
          <div className="fx-gutter">
            <ul className="fx-stack fx-stack--sm py-3">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="fx-touch w-full text-ink"
                    aria-current={pathname === link.href ? 'page' : undefined}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {signedIn && (
                <li>
                  <button
                    type="button"
                    onClick={() => signOut()}
                    className="fx-touch w-full text-left text-muted"
                  >
                    Sign out
                  </button>
                </li>
              )}
            </ul>
          </div>
        </nav>
      )}
    </header>
  );
}

/**
 * The link set, derived once.
 *
 * Returns `[]` while the session is in flight — see the note at the top about
 * not guessing. "Events" is the only link that does not depend on who is
 * asking, so it is the only one outside the conditional.
 */
function navLinks({ signedIn, loading, user, pathname }) {
  const events = [{ href: '/events', label: 'Events' }];
  if (loading) return events;

  if (signedIn) {
    return [
      ...events,
      { href: '/account/tickets', label: 'My tickets' },
      // Only shown to someone who actually has an organizer profile. Offering
      // it to everyone would send buyers to a dashboard they have no account
      // for.
      ...(user?.isOrganizer ? [{ href: '/organizer', label: 'Organizer' }] : []),
    ];
  }

  return [
    ...events,
    { href: '/tickets/find', label: 'Find my tickets' },
    { href: `/login?next=${encodeURIComponent(pathname || '/')}`, label: 'Sign in' },
  ];
}

/**
 * One desktop link.
 *
 * `aria-current="page"` rather than only a colour. The active item has to be
 * identifiable by something other than a shade of grey, both for a screen
 * reader and for anyone who cannot separate `--es-text` from `--es-text-muted`
 * — which is a 2.4:1 difference between two greys, not a colour cue at all.
 */
function NavLink({ link, pathname }) {
  const active = pathname === link.href;
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={`fx-touch text-sm transition-colors hover:text-ink ${
        active ? 'text-ink' : 'text-muted'
      }`}
    >
      {link.label}
    </Link>
  );
}

/**
 * The burger, drawn rather than typed.
 *
 * A `☰` character is a font-dependent glyph that renders at a different weight
 * and baseline on every platform, and is read aloud by some screen readers as
 * "trigram for heaven". Two lines that cross into an ✕ cost the same and say
 * what they do — the button's `aria-label` carries the meaning either way.
 */
function Burger({ open }) {
  return (
    <span aria-hidden className="relative block h-4 w-5">
      <span
        className={`absolute left-0 block h-px w-5 bg-current transition-transform duration-200 ${
          open ? 'top-2 rotate-45' : 'top-1'
        }`}
      />
      <span
        className={`absolute left-0 block h-px w-5 bg-current transition-transform duration-200 ${
          open ? 'top-2 -rotate-45' : 'top-[11px]'
        }`}
      />
    </span>
  );
}
