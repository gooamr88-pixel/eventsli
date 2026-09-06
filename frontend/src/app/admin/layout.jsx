'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import { Loading, Empty } from '../components/Feedback';

/**
 * The admin shell.
 *
 * `proxy.ts` bounces anyone without a session cookie and every endpoint under
 * /admin is behind `requireRole('admin')`, so this adds no gate of its own —
 * but it does render a plain refusal for a signed-in NON-admin who followed a
 * link here. Without it they would see an empty console and a row of failing
 * requests, which reads as broken rather than as "not for you".
 */
const TABS = [
  ['/admin', 'Approvals'],
  ['/admin/invoices', 'Invoices'],
  ['/admin/users', 'People'],
  ['/admin/settings', 'Settings'],
  ['/admin/audit', 'Audit'],
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--wide fx-stack">
        <div className="fx-row fx-row--between">
          <h1 className="text-2xl">Administration</h1>
          {user?.isSuperAdmin && (
            <span className="es-pill es-pill--accent">
              Super admin
            </span>
          )}
        </div>

        {loading ? (
          <Loading variant="text" />
        ) : !user?.isAdmin ? (
          /* A refusal, not an error. `.es-empty` rather than a card: the
             dashed edge says "nothing here for you" where a solid card says
             "here is a thing", and the second is what made this read as a
             broken page rather than a closed door. */
          <Empty
            title="This area is for platform staff."
            hint="If you organise events, your dashboard is under Organizer."
            action={{ href: '/', label: 'Back to events' }}
          />
        ) : (
          <>
            <nav className="fx-row fx-row--scroll border-b border-border-base" aria-label="Admin">
              {TABS.map(([href, label]) => {
                const active = href === '/admin' ? pathname === href : pathname?.startsWith(href);
                return (
                  <Link key={href} href={href} aria-current={active ? 'page' : undefined} className="es-tab">
                    {label}
                  </Link>
                );
              })}
            </nav>
            {children}
          </>
        )}
      </div>
    </main>
  );
}
