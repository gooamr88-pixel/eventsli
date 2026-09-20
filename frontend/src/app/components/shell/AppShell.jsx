'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavIcon from './NavIcon';
import { trapTab } from '../../utils/focusTrap';
import Logo from '../brand/Logo';
import { resolveNav, pickTabs, currentLabel } from './navModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The dashboard shell — shared by ALL THREE workspaces now: the buyer's account,
 * the organizer dashboard and the admin console, so the three read as one
 * product with the same sidebar, the same logo and the same way out.
 *
 *   phone    an app bar, a bottom tab bar, and a drawer
 *   tablet   an icon rail (always there) and the same drawer for labels
 *   laptop+  the full sidebar
 * The arrangement is CSS (.es-nav-* in globals.css); this component renders one
 * markup for all three.
 *
 * THE BUYER'S ACCOUNT WAS NOT ONE OF THESE. It was a plain `<main>` under the
 * marketing masthead with two segmented tabs, so the account type every user on
 * the platform has got the least navigation of the three — and `SiteHeader`'s
 * `APP_SHELL_PREFIXES` had to grow `/account` at the same time, or the site
 * header would render on top of this sidebar's logo.
 *
 * Four behaviours are really bug fixes rather than styling, and are fancy's:
 *   · Real <Link>s, never onClick + router.push — middle-click and "open in new
 *     tab" work on every destination.
 *   · A disabled destination is a <span> with its reason in `title`.
 *   · The bottom bar is picked BY KEY from the same list the sidebar renders.
 *   · The drawer closes when the route changes — adjusted during render, so the
 *     new page is never painted with the old drawer over it.
 *
 * And one that is not fancy's: opening the drawer moves focus into it, and
 * closing it returns focus to the button that opened it. Before, a keyboard
 * user opened the menu and was still standing on the page behind the scrim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `workspace`, WHICH USED TO BE CALLED `role`.
 *
 * Renamed because "role" is the one word this pass exists to stop overloading.
 * In this product a role is `attendee | organizer | admin | super_admin` — a
 * PERMISSION, granted server-side, checked by `requireRole` — while this prop is
 * the name of the surface somebody is looking at. They are not the same thing and
 * conflating them in the client is what produced most of the confusion being
 * fixed here; a prop called `role` holding "Tickets" was that conflation written
 * into the shell's own signature.
 *
 * It is still only a LABEL. Nothing is decided from it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT `head` AND `contextBar` ARE, after this pass rearranged both.
 *
 * `head`   goes at the top of the SCROLLING nav list, not in the pinned block
 *          with the logo. The pinned block and the footer are both
 *          `flex-shrink: 0` inside a panel that is exactly `100dvh` with
 *          `overflow: hidden`, so everything pinned is height the list cannot
 *          have — and once the pinned pair exceeds the viewport, the footer is
 *          simply clipped. With the workspace switcher up there that is not
 *          theoretical: brand + label + two 44px workspace cards + padding is
 *          about 202px, the footer is about 180px, and a phone held sideways
 *          has 375px of `dvh`. Sign out went off the bottom of a panel whose
 *          own comment says it was rewritten to stop exactly that happening.
 *          In the scroller it costs the list nothing.
 *
 * `contextBar`  a full-width strip BELOW THE APP BAR AND ABOVE THE PAGE, in the
 *          shell's own chrome. The organizer's "Working on…" bar used to be the
 *          first child of `<main>`, stickied with a hard-coded `top: 56px` to
 *          clear an app bar whose height is `56px` PLUS the top safe-area inset
 *          — so on any notched phone it parked forty pixels behind a blurred
 *          translucent bar. Sticking the two together as one group means there
 *          is no offset to keep in step, and no second opinion about the
 *          stacking order either.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AppShell({
  workspace, label, home = '/', groups, slots, tabKeys = [], head, contextBar, foot, appbarAction, children,
}) {
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const navRef = useRef(null);
  const menuRef = useRef(null);
  const wasOpen = useRef(false);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (open) {
      navRef.current?.focus({ preventScroll: true });
    } else if (wasOpen.current && navRef.current?.contains(document.activeElement)) {
      menuRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;

    if (!open) return undefined;
    // Escape closes, and Tab stays in the drawer while it is open. Moving
    // focus in (above) was only half of it: the next Tab left the panel for
    // the page behind the scrim, so a keyboard user was operating a screen
    // they could not see through a black overlay. Below `lg` this panel IS
    // the navigation, so there is nothing else to reach while it is open.
    const onKey = (e) => {
      /**
       * A MODAL DIALOG OPENED FROM INSIDE THE DRAWER OWNS THE KEYBOARD.
       *
       * `showModal()` puts everything outside the dialog — this drawer
       * included — into the inert subtree, and it runs its own Tab trap. With
       * both live, Tab was handled twice: the dialog kept focus inside itself
       * and then this handler called `preventDefault` and moved focus back
       * into the nav, which is inert while the dialog is up. Focus landed
       * somewhere the reader could neither see nor use.
       *
       * Escape is the same story in miniature — it would close the drawer out
       * from under the dialog that is asking the question.
       *
       * Checked against the DOM rather than tracked in state because the
       * dialog is opened by whatever was passed in as `foot`, which this
       * component knows nothing about.
       */
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      trapTab(e, navRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const resolved = resolveNav(groups, pathname);
  const tabs = pickTabs(resolved, tabKeys);
  const here = currentLabel(resolved);

  return (
    <>
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-(--es-z-max) es-btn es-btn--primary"
      >
        Skip to content
      </a>

      <aside
        id="app-nav"
        ref={navRef}
        tabIndex={-1}
        className={`es-nav es-band--field ${open ? 'es-nav--open' : ''}`}
        aria-label={label}
      >
        <div className="es-nav__head">
          <div className="es-nav__brand">
            <Link href={home} aria-label={`Eventsli — ${workspace} home`} className="fx-touch">
              <Logo />
            </Link>
            {/* The chip beside the logo IS the answer to "which workspace am I
                in". `.es-nav__role` keeps its class name: renaming it would be a
                CSS change with no behaviour behind it, and the shell's stylesheet
                is not where this distinction needs restating. */}
            <span className="es-nav__role">{workspace}</span>
          </div>
        </div>

        <nav className="es-nav__body" aria-label={label}>
          {/* Above the first group and inside the scroller — see the note on
              the props. It is separated by a rule rather than by the panel's
              own border, so it still reads as its own block. */}
          {head && <div className="es-nav__lead">{head}</div>}
          {resolved.map((group) => (
            <div key={group.id} className="es-nav__group">
              {group.label && (
                <p id={`nav-group-${group.id}`} className="es-nav__group-label">{group.label}</p>
              )}
              {group.items.length > 0 && (
                <ul
                  className="flex flex-col gap-0.5"
                  aria-labelledby={group.label ? `nav-group-${group.id}` : undefined}
                >
                  {group.items.map((item) => (
                    <li key={item.key}><NavItem item={item} /></li>
                  ))}
                </ul>
              )}
              {group.note && <p className="es-nav__note">{group.note}</p>}
            </div>
          ))}
        </nav>

        {foot && <div className="es-nav__foot">{foot}</div>}
      </aside>

      {open && (
        <button type="button" className="es-nav-scrim" aria-label="Close the menu" onClick={() => setOpen(false)} />
      )}

      <div className="es-nav-content">
        {/* ONE STICKY GROUP, not two stickies guessing at each other's height.
            The app bar disappears at `lg`, so above that this is the context
            bar alone, pinned to the top of the window on its own. */}
        <div className="es-shell-top">
          <header className="es-appbar">
            <button
              ref={menuRef}
              type="button"
              className="es-btn es-btn--ghost fx-touch--icon"
              aria-expanded={open}
              aria-controls="app-nav"
              aria-label="Open the menu"
              onClick={() => setOpen(true)}
            >
              <NavIcon name="menu" />
            </button>
            <Link href={home} aria-label={`Eventsli — ${workspace} home`} className="fx-touch">
              <Logo size="sm" mark />
            </Link>
            {/*
              ─────────────────────────────────────────────────────────────────────
              TWO LINES, BECAUSE ONE OF THEM ANSWERED THE WRONG QUESTION.

              This was `{here || role}` — the page's name, falling back to the
              workspace only when the route was not in the nav. So on a phone, which
              is the width where the sidebar is a closed drawer and this bar is the
              ONLY navigation on screen, an organizer on the orders screen read
              "Orders" and a buyer on theirs read "Orders", with nothing anywhere
              saying which half of the product they were in. The one place the
              workspace is named — the chip beside the sidebar's logo — was behind
              the menu.

              Where am I, then what page: the workspace above, small and subtle,
              and the page in the reading weight under it. Both fit at 320px because
              they are stacked rather than joined by a separator, which is what a
              single truncated line would have had to do.
              ─────────────────────────────────────────────────────────────────────
            */}
            <span className="fx-min0 flex-1 flex flex-col justify-center leading-tight">
              {/* `text-xs`, the token, rather than an arbitrary pixel value — the
                  two lines plus `leading-tight` come to about 30px inside a 56px
                  bar, so there is no reason to reach below the ramp for it. */}
              <span className="fx-truncate text-xs uppercase tracking-wide text-subtle">
                {workspace}
              </span>
              {here && (
                <span className="fx-truncate text-sm font-medium text-ink">{here}</span>
              )}
            </span>
            {/* THE THEME CONTROL WAS HERE. It went with the theme — the product
                is one palette now, and the door scanner pins its own dark
                subtree without anybody choosing it. See globals.css. */}
            {appbarAction}
          </header>

          {contextBar}
        </div>

        <main id="app-main" className="es-app-main">
          {children}
        </main>
      </div>

      <nav className="es-nav-bar" aria-label={`${label} shortcuts`}>
        {tabs.map((tab) => (
          tab.disabled ? (
            <span key={tab.key} className="es-nav-bar__tab" aria-disabled="true" title={tab.hint || undefined}>
              <NavIcon name={tab.icon} />
              <span>{tab.label}</span>
            </span>
          ) : (
            <Link
              key={tab.key}
              href={tab.href}
              className="es-nav-bar__tab"
              aria-current={tab.active ? 'page' : undefined}
            >
              <NavIcon name={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          )
        ))}
        <button
          type="button"
          className="es-nav-bar__tab"
          aria-expanded={open}
          aria-controls="app-nav"
          onClick={() => setOpen(true)}
        >
          <NavIcon name="menu" />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

function NavItem({ item }) {
  const inner = (
    <>
      <span className="es-nav__icon"><NavIcon name={item.icon} /></span>
      <span className="es-nav__label">{item.label}</span>
      {item.badge ? <span className="es-nav__badge">{item.badge}</span> : null}
    </>
  );

  if (item.disabled) {
    return (
      <span className="es-nav__item" aria-disabled="true" title={item.hint || undefined}>
        {inner}
        {item.hint && <span className="sr-only"> — {item.hint}</span>}
      </span>
    );
  }

  return (
    <Link href={item.href} className="es-nav__item" aria-current={item.active ? 'page' : undefined}>
      {inner}
    </Link>
  );
}
