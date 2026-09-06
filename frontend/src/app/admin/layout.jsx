'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';

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
            <span className="rounded-full bg-accent-wash px-3 py-1 font-mono text-[10px] uppercase tracking-[0.09em] text-accent">
              Super admin
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-subtle">Loading…</p>
        ) : !user?.isAdmin ? (
          <div className="rounded-[--es-radius-lg] border border-border-base bg-surface p-8 text-center">
            <p className="text-ink">This area is for platform staff.</p>
            <Link href="/" className="mt-2 inline-block text-sm text-accent">
              Back to events
            </Link>
          </div>
        ) : (
          <>
            <nav className="fx-row fx-row--scroll border-b border-border-base" aria-label="Admin">
              {TABS.map(([href, label]) => {
                const active = href === '/admin' ? pathname === href : pathname?.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
                      active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
                    }`}
                  >
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
