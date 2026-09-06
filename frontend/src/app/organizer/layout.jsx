'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The organizer shell.
 *
 * No auth or role check here — `proxy.ts` bounces anyone without a session
 * cookie, and every endpoint underneath is behind `requireAuth` +
 * `requireRole('organizer')` + `requireActiveOrganizer`, each re-checked per
 * request. A fourth check in a layout would be the only one a forged cookie
 * gets past, which is the wrong place to put confidence.
 *
 * What this DOES handle is the shape of the nav: the per-event pages get their
 * own tabs from the event layout, and this one carries only what is
 * account-wide.
 */
const TABS = [
  ['/organizer', 'Events'],
  ['/organizer/payouts', 'Payouts'],
  ['/organizer/profile', 'Profile'],
];

export default function OrganizerLayout({ children }) {
  const pathname = usePathname();

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--wide fx-stack">
        <div className="fx-row fx-row--between">
          <h1 className="text-2xl">Organizer</h1>
          <Link href="/organizer/events/new" className="es-btn es-btn--primary">
            New event
          </Link>
        </div>

        <nav className="fx-row fx-row--scroll border-b border-border-base" aria-label="Organizer">
          {TABS.map(([href, label]) => {
            // Exact match for the index tab, prefix for the rest — otherwise
            // "Events" stays highlighted on every page underneath it.
            const active = href === '/organizer'
              ? pathname === href
              : pathname?.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} className="es-tab">
                {label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </main>
  );
}
