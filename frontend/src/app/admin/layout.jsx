'use client';

import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import WorkspaceSwitcher from '../components/shell/WorkspaceSwitcher';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { Loading, Empty } from '../components/Feedback';
import { defaultWorkspace, WORKSPACE_HOME, WORKSPACE_LABEL } from '../lib/workspaces';
import { adminNavGroups, ADMIN_TABS } from './nav/adminNav';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The admin console shell — the same shell as the organizer dashboard, so the
 * two halves of the product look and move alike.
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

  /**
   * PERMISSION DENIED, AND IT SENDS THEM SOMEWHERE THEY CAN ACTUALLY BE.
   *
   * It used to offer `/organizer` to an organizer and `/` — the storefront — to
   * everybody else, which meant a signed-in buyer who followed a stale admin link
   * was answered by being logged out of the product's furniture entirely. There
   * was nowhere else to send them, because the buyer workspace did not exist.
   *
   * `defaultLanding` is the same rule the switcher and `/login` use, so a refusal
   * hands somebody to the same place every other "where do you belong" question
   * would. It also names the workspace, so the sentence says what they are being
   * offered rather than "Go to your dashboard" for one of three possible ones.
   */
  if (!loading && !user?.isAdmin) {
    const home = defaultWorkspace(user);
    return (
      <main className="fx-section fx-section--sm">
        <div className="fx-container fx-container--md fx-gutter">
          <Empty
            title="This area is for platform staff."
            hint="Your account does not have admin permissions. Nothing is wrong with it — this is simply a different part of the product."
            action={{ href: WORKSPACE_HOME[home], label: `Go to ${WORKSPACE_LABEL[home]}` }}
          />
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          // The workspace is "Admin" either way; the SUPER admin distinction is a
          // permission, and naming it here is the one place that saying so is
          // useful — it is the difference between being able to grant a staff role
          // and not, and an admin who has it should be able to see that they do.
          workspace={user?.isSuperAdmin ? 'Super admin' : 'Admin'}
          label="Administration"
          home="/admin/overview"
          groups={adminNavGroups()}
          tabKeys={ADMIN_TABS}
          /**
           * The way back to the other halves of the product, at the TOP of the
           * panel rather than in its footer.
           *
           * "Organizer dashboard" was a footer link one row above "Sign out", and
           * it was shown on `isOrganizer` — the permission — so an Eventsli staff
           * member who had signed up to sell and not finished setting up had no
           * route to the screen that would let them. The switcher reads
           * `accountTypes` as well, which is the fact that answers it.
           */
          head={<WorkspaceSwitcher />}
          foot={(
            <ShellFoot
              user={user}
              links={[{ href: '/', label: 'View the site', icon: 'globe' }]}
            />
          )}
        >
          {loading ? <Loading variant="stats" rows={4} label="Loading the console" /> : children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}
