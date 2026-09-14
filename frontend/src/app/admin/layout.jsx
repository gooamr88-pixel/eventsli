'use client';

import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { Loading, Empty } from '../components/Feedback';
import { adminNavGroups, ADMIN_TABS } from './nav/adminNav';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The admin console shell.
 *
 * `proxy.ts` bounces anyone without a session cookie and every endpoint under
 * /admin is behind `requireRole('admin')`, so this adds no gate of its own —
 * but it does render a plain refusal for a signed-in NON-admin who followed a
 * link here. Without it they would see an empty console and a row of failing
 * requests, which reads as broken rather than as "not for you".
 *
 * The pages are not rendered until the role is known, so a non-admin never
 * fires the console's requests at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminLayout({ children }) {
  const { user, loading } = useAuth();

  if (!loading && !user?.isAdmin) {
    return (
      <main className="fx-section fx-section--sm">
        <div className="fx-container fx-container--md fx-gutter">
          <Empty
            title="This area is for platform staff."
            hint="If you organise events, your dashboard is under Organizer."
            action={{ href: '/', label: 'Back to events' }}
          />
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          role={user?.isSuperAdmin ? 'Super admin' : 'Admin'}
          label="Administration"
          groups={adminNavGroups()}
          tabKeys={ADMIN_TABS}
          foot={(
            <ShellFoot
              links={[
                ...(user?.isOrganizer ? [{ href: '/organizer', label: 'Organizer dashboard', icon: 'calendar' }] : []),
                { href: '/', label: 'View the site', icon: 'globe' },
              ]}
            />
          )}
        >
          {loading ? <Loading variant="stats" rows={4} label="Loading the console" /> : children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}
