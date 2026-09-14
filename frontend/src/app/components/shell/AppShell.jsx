'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavIcon from './NavIcon';
import { resolveNav, pickTabs, currentLabel } from './navModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The dashboard shell: a sidebar from lg up; a drawer, an app bar and a bottom
 * tab bar below it. Shared by the organizer dashboard and the admin console.
 *
 * The arrangement is fancy's, and so are the four behaviours that are really
 * bug fixes rather than styling:
 *
 *   · Real <Link>s, never onClick + router.push — so middle-click, cmd-click
 *     and "open in new tab" work on every destination.
 *   · A disabled destination is a <span> with its reason in `title`, not a
 *     disabled anchor, which several browsers still follow from the keyboard.
 *   · The bottom bar is picked BY KEY from the same list the sidebar renders.
 *   · The drawer closes when the route changes — adjusted during render, not in
 *     an effect, so the new page is never painted with the old drawer over it.
 *
 * What is NOT fancy's: no inline styles, and no !important. The CSS in
 * globals.css writes the mobile state as the base and ADDS the desktop state in
 * a media query, so nothing has to be beaten.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AppShell({ role, label, groups, tabKeys = [], head, foot, children }) {
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
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
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[--es-z-max] es-btn es-btn--primary"
      >
        Skip to content
      </a>

      <aside id="app-nav" className={`es-nav ${open ? 'es-nav--open' : ''}`} aria-label={label}>
        <div className="es-nav__head fx-stack fx-stack--sm">
          <Link href="/" className="es-nav__brand">
            <span className="es-nav__brand-name">Eventsli</span>
            <span className="es-nav__brand-role">{role}</span>
          </Link>
          {head}
        </div>

        <nav className="es-nav__body" aria-label={label}>
          {resolved.map((group) => (
            <div key={group.id}>
              {group.label && (
                <p id={`nav-group-${group.id}`} className="es-nav__group-label">{group.label}</p>
              )}
              <ul
                className="flex flex-col gap-0.5"
                aria-labelledby={group.label ? `nav-group-${group.id}` : undefined}
              >
                {group.items.map((item) => (
                  <li key={item.key}><NavItem item={item} /></li>
                ))}
              </ul>
              {group.note && <p className="es-nav__note">{group.note}</p>}
            </div>
          ))}
        </nav>

        {foot && <div className="es-nav__foot fx-stack fx-stack--sm">{foot}</div>}
      </aside>

      {open && (
        <button type="button" className="es-nav-scrim" aria-label="Close the menu" onClick={() => setOpen(false)} />
      )}

      <div className="es-nav-content">
        <header className="es-appbar">
          <button
            type="button"
            className="es-btn es-btn--ghost fx-touch--icon"
            aria-expanded={open}
            aria-controls="app-nav"
            aria-label="Open the menu"
            onClick={() => setOpen(true)}
          >
            <NavIcon name="menu" />
          </button>
          <p className="fx-truncate fx-min0 text-sm text-ink">{here || role}</p>
          <Link href="/" className="fx-touch font-serif text-lg text-ink">Eventsli</Link>
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
