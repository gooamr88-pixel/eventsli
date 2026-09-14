'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';

/**
 * The account shell.
 *
 * No auth check here. `proxy.ts` already bounces anyone without a session
 * cookie, and every endpoint these pages call is behind `requireAuth` — which
 * re-checks the session against the database on every request. A third check in
 * a layout would be a third place to get it wrong, and it would be the only one
 * of the three that a forged cookie gets past.
 *
 * The role flags below only decide which SHORTCUT to show. The dashboard and
 * the console enforce their own access; a wrong flag here costs a dead link,
 * not a permission.
 */
const TABS = [
  ['/account/tickets', 'Tickets'],
  ['/account/security', 'Security'],
];

export default function AccountLayout({ children }) {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--lg fx-stack">
        <div className="es-page-head">
          <div className="fx-stack fx-stack--sm fx-min0">
            <p className="es-eyebrow">Your account</p>
            <h1 className="es-page-head__title fx-break">{user?.fullName || 'Your account'}</h1>
            {user?.email && <p className="es-page-head__lede">{user.email}</p>}
          </div>
          <div className="fx-row">
            {user?.isAdmin && <Link href="/admin/overview" className="es-btn es-btn--secondary es-btn--sm">Console</Link>}
            {user?.isOrganizer && <Link href="/organizer" className="es-btn es-btn--primary es-btn--sm">Organizer dashboard</Link>}
          </div>
        </div>

        <nav className="es-segmented self-start" aria-label="Account">
          {TABS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className="es-segmented__option"
            >
              {label}
            </Link>
          ))}
        </nav>

        {children}
      </div>
    </main>
  );
}
