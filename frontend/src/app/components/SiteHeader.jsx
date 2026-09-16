'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, signOut } from '../hooks/useAuth';
import Logo from './brand/Logo';
import ThemeToggle from './ThemeToggle';

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
   * THE HEADER SITS ON THE HERO'S PHOTOGRAPH, on the one page that has one.
   *
   * Transparent while the hero is behind it, solid once the page has scrolled
   * past it. `.es-overhero[data-over="true"]` inverts the text ROLES rather
   * than setting a white `color` — the same reason `.es-band--ink` does, and
   * the same failure it avoids: setting `color` alone leaves every `text-muted`
   * child at slate-600 on a photograph.
   *
   * `useSyncExternalStore`, not `useState` + `useEffect`. Scroll position is an
   * external store, and this is the hook for reading one: there is no setState
   * to land in the wrong render, and it is what
   * `react-hooks/set-state-in-effect` exists to push a scroll listener
   * towards. The first attempt here did call setState inside the effect and
   * the linter refused it — correctly, because the synchronous initial call
   * produces a render React immediately discards.
   *
   * THE SERVER SNAPSHOT IS `false`, and that is the safety property. The
   * readable solid header is what renders on the server and before hydration,
   * so a JavaScript failure leaves a legible masthead rather than white text
   * on cream paper.
   */
  const onHeroPage = pathname === '/';
  /**
   * NOT WHILE THE MENU IS OPEN.
   *
   * The transparent state paints the bar's contents white for the
   * photograph behind them. Open the phone menu and the panel below is a
   * white surface — so the wordmark and the links above it were white on
   * white and simply vanished. Reported as "the logo is not visible in the
   * navbar", and it was: it was there, in white, on white.
   *
   * An open menu means the header is chrome over a panel, not over a
   * picture, whatever the scroll position says.
   */
  const overHero = useOverHero(onHeroPage) && !menuOpen;

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

  /**
   * A tap anywhere outside the header closes it.
   *
   * Escape already did, and Escape is not a key anybody has on a phone —
   * which is where this menu exists. Without this the only way out was the
   * burger itself or navigating, so a mis-tap left the panel sitting over
   * the page.
   *
   * `pointerdown`, not `click`: it fires before focus moves and before a
   * scroll can start, so the panel is gone by the time the finger lifts.
   * Bound to the document and filtered by `closest('header')`, which is one
   * check rather than a ref on every element the header contains.
   */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onOutside = (e) => {
      if (!e.target.closest?.('header')) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [menuOpen]);

  const links = navLinks({ signedIn, loading, user, pathname });
  const cta = navCta({ signedIn, loading, user });

  return (
    <header
      data-over={overHero ? 'true' : 'false'}
      // The background, the border and the blur are NOT utilities here. They
      // live in `.es-overhero` so the transparent state can win — a utility
      // sits in a later cascade layer and beat it. See globals.css.
      className="es-overhero sticky top-0 z-(--es-z-navbar) transition-colors duration-300"
    >
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl">
          <div className="fx-row fx-row--between h-16">
            <Link href="/" aria-label="Eventsli — home" className="fx-touch">
              <Logo />
            </Link>

            {/* ── Desktop ────────────────────────────────────────────
                One nav element, two renderings. The links come from the
                same `navLinks()` call, so the phone can never be offered a
                different set from the desktop — which is how "Find my
                tickets" goes missing on mobile and nobody notices for a
                month. */}
            {/* THREE LEVELS, where there was one.
                Every item here used to be the same muted 14px link — the
                destination someone is most likely to want (sign in, or the
                dashboard they are paying us for) was styled exactly like
                "Events", so the bar had no shape and the eye had nowhere to
                land. Now: plain links read as navigation, one button is the
                obvious next step, and the theme control is an icon that does
                not compete with either. */}
            <nav className="fx-hide-below-md fx-row" aria-label="Main">
              {links.map((link) => (
                <NavLink key={link.href} link={link} pathname={pathname} />
              ))}
              <ThemeToggle className="ml-1" />
              {signedIn && (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="es-btn es-btn--ghost es-btn--sm"
                >
                  Sign out
                </button>
              )}
              {cta && (
                <Link href={cta.href} className="es-btn es-btn--primary es-btn--sm whitespace-nowrap">
                  {cta.label}
                </Link>
              )}
            </nav>

            {/* The theme control sits OUTSIDE the phone's panel, next to the
                burger, because it is a setting rather than a destination —
                putting it in the list would make it the fourth "page" on a
                menu of three. */}
            <div className="fx-row md:hidden">
              <ThemeToggle />

            {/* ── The phone's button ─────────────────────────────────
                `aria-expanded` and `aria-controls` are not decoration: they
                are the only thing that tells a screen reader this button
                owns a panel and whether the panel is open. A bare button
                announces as "Menu, button" and gives no way to know that
                pressing it did anything. */}
            <button
              type="button"
              // `md:hidden`, a utility, not `.fx-only-below-md`: that is a
              // component-layer rule earlier in the file than `.es-btn`, whose
              // `display: inline-flex` won — so the burger showed on desktops.
              className="es-btn es-btn--ghost fx-touch--icon md:hidden"
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
          className="border-t border-border-base bg-surface md:hidden"
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
              {/* The same one action the desktop bar promotes, as a full-width
                  button at the end of the list rather than a fourth link — so
                  the phone and the desktop agree about what the next step is. */}
              {cta && (
                <li className="pt-1">
                  <Link href={cta.href} className="es-btn es-btn--primary w-full">
                    {cta.label}
                  </Link>
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
 * Whether the masthead is still over the hero's photograph.
 *
 * The threshold is deliberately short of the hero's full height. The header has
 * to become solid while there is still photograph behind it — switching exactly
 * at the boundary leaves the last few pixels of scroll with white text on the
 * pale top of the next band.
 */
function useOverHero(enabled) {
  return useSyncExternalStore(
    (onChange) => {
      if (!enabled) return () => {};
      // `passive`: this never calls preventDefault, and a non-passive scroll
      // listener blocks the compositor on every frame of every scroll.
      window.addEventListener('scroll', onChange, { passive: true });
      return () => window.removeEventListener('scroll', onChange);
    },
    /* AT THE TOP, and almost nowhere else.
       The threshold was 60% of the viewport, so on a phone the bar stayed
       transparent while the whole headline scrolled under it — white type
       over white type, which is what the overlap in the reported
       screenshots actually was. A header is only over the photograph
       while the page has not moved; the moment it has, it is over
       content and has to be a surface. */
    () => enabled && window.scrollY < 8,
    () => false,
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
  /**
   * THE BROWSE LINKS EVERY VISITOR GETS, signed in or not.
   *
   * There was one — "Events" — and the bar had nothing in it. The design this
   * storefront was built to carries six, and the four here are the ones that
   * point at pages this product actually has. There is deliberately no
   * "Pricing" or "Sponsors" entry: neither page exists, and a nav link to a
   * 404 is worse than a shorter nav.
   */
  const browse = [
    { href: '/events', label: 'Events' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/why-us', label: 'For organizers' },
  ];
  if (loading) return browse;

  if (signedIn) {
    return [
      ...browse,
      { href: '/account/tickets', label: 'My tickets' },
      // Only shown to someone who actually has an organizer profile. Offering
      // it to everyone would send buyers to a dashboard they have no account
      // for.
      ...(user?.isOrganizer ? [{ href: '/organizer', label: 'Organizer' }] : []),
    ];
  }

  return [
    ...browse,
    { href: '/tickets/find', label: 'Find my tickets' },
    { href: `/login?next=${encodeURIComponent(pathname || '/')}`, label: 'Sign in' },
  ];
}

/**
 * The one promoted action, and it changes with who is asking.
 *
 * The homepage has said since it was written that this site has two readers —
 * somebody looking for a ticket, and somebody deciding whether to sell here —
 * but the second reader could only find that out by scrolling to the fifth
 * band. This puts their next step in the masthead on every page.
 *
 * Routes only, no new ones: `/register` and `/organizer` both already exist and
 * are already linked from the homepage and the footer.
 *
 * Nothing at all while the session is in flight. A CTA that says "Start
 * selling" for a moment and then becomes "Organizer" is a button that moves
 * under the pointer of the organizer who was already reaching for it.
 */
function navCta({ signedIn, loading, user }) {
  if (loading) return null;
  if (signedIn && user?.isOrganizer) return { href: '/organizer/events/new', label: 'Create event' };
  if (signedIn) return { href: '/organizer', label: 'Create event' };
  return { href: '/register', label: 'Create event' };
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
