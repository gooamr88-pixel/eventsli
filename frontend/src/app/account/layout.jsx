'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The account shell.
 *
 * No auth check here. `proxy.ts` already bounces anyone without a session
 * cookie, and every endpoint these pages call is behind `requireAuth` — which
 * re-checks the session against the database on every request. A third check in
 * a layout would be a third place to get it wrong, and it would be the only one
 * of the three that a forged cookie gets past.
 */
const TABS = [
  ['/account/tickets', 'Tickets'],
  ['/account/security', 'Security'],
];

export default function AccountLayout({ children }) {
  const pathname = usePathname();

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--lg fx-stack">
        <h1 className="text-2xl">Your account</h1>

        <nav className="fx-row fx-row--scroll border-b border-border-base" aria-label="Account">
          {TABS.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
                  active
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
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
