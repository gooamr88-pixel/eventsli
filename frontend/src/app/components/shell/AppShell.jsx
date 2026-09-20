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
 * The dashboard shell, shared by the organizer dashboard and the admin console
 * so the two read as one product: the same emerald sidebar, the same logo, the
 * same way to the other side and out.
 *
 *   phone    an app bar, a bottom tab bar, and a drawer
 *   tablet   an icon rail (always there) and the same drawer for labels
 *   laptop+  the full sidebar
 * The arrangement is CSS (.es-nav-* in globals.css); this component renders one
 * markup for all three.
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
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AppShell({
  role, label, home = '/', groups, tabKeys = [], head, foot, appbarAction, children,
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
            <Link href={home} aria-label={`Eventsli — ${role} home`} className="fx-touch">
              <Logo />
            </Link>
            <span className="es-nav__role">{role}</span>
          </div>
          {head}
        </div>

        <nav className="es-nav__body" aria-label={label}>
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
          <Link href={home} aria-label={`Eventsli — ${role} home`} className="fx-touch">
            <Logo size="sm" mark />
          </Link>
          <p className="fx-truncate fx-min0 flex-1 text-sm font-medium text-ink">{here || role}</p>
          {/* THE THEME CONTROL WAS HERE. It went with the theme — the product
              is one palette now, and the door scanner pins its own dark
              subtree without anybody choosing it. See globals.css. */}
          {appbarAction}
        </header>

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
