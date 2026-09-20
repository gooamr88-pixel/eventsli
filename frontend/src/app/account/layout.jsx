'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/shell/AppShell';
import ShellFoot from '../components/shell/ShellFoot';
import WorkspaceSwitcher from '../components/shell/WorkspaceSwitcher';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';
import { useAuth } from '../hooks/useAuth';
import { get } from '../utils/apiClient';
import { summariseOrders } from '../lib/buyerOrders';
import { AccountOrdersProvider } from './nav/AccountOrders';
import { accountNavGroups, ACCOUNT_TABS } from './nav/accountNav';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The buyer's shell — the third one, which should always have been there.
 *
 * WHAT THIS REPLACES. A `<main>` with the reader's own name as its `<h1>`, their
 * email under it, two segmented tabs (Tickets, Security) and two buttons in the
 * corner labelled "Console" and "Organizer dashboard". An account-settings
 * screen standing in for a workspace.
 *
 * Every problem with it followed from that one substitution:
 *
 *   · The `<h1>` was the person's name, so every page in the workspace had the
 *     same heading and none of them said which page it was.
 *   · The two corner buttons were the only route to the other halves of the
 *     product, and they were styled as page actions — so "go to the admin
 *     console" sat where "save" belongs.
 *   · There was no dashboard to be the home of, which is why the API's landing
 *     rule pointed at `/account/tickets`: a sub-page, because the parent 404'd.
 *
 * It is `AppShell` now, the same component the organizer dashboard and the admin
 * console use, so the three surfaces read as three rooms in one building rather
 * than as two products and an afterthought. Nothing about the two existing
 * screens changed; they are inside a shell that can say where they are.
 *
 * NO AUTH CHECK HERE, and the reasoning is the previous layout's, kept verbatim
 * because it is still exactly right: `proxy.ts` already bounces anyone without a
 * session cookie, and every endpoint these pages call is behind `requireAuth`,
 * which re-checks the session against the database on every request. A third
 * check in a layout would be a third place to get it wrong, and it would be the
 * only one of the three a forged cookie gets past.
 *
 * WHY THERE IS NO ROLE GATE EITHER, unlike `admin/layout.jsx`. That one refuses
 * a signed-in non-admin, because an empty console and a row of failing requests
 * reads as broken rather than as "not for you". This workspace cannot have that
 * problem: every signed-in account is a buyer — the API normalises an empty
 * `account_types` to `['buyer']` — so there is nobody to refuse.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AccountLayout({ children }) {
  const { user } = useAuth();

  /**
   * ONE FETCH OF `GET /tickets` FOR THE WHOLE WORKSPACE.
   *
   * `{ orders, loadedAt, error }` together rather than three pieces of state:
   * `loadedAt` is the instant the split between upcoming and past is measured
   * against, and it has to move with the payload it describes or a re-render can
   * pair new orders with an old instant. `AccountOrders.jsx` argues it at
   * length.
   *
   * `orders: null` is "not yet", `[]` is "none" — a distinction the empty states
   * depend on, because "you have not bought anything" and "still loading" want
   * completely different screens.
   */
  const [state, setState] = useState({ orders: null, loadedAt: 0, error: null });
  /** Bumped so a failed load can be retried from whichever screen reported it. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/tickets', { cache: 'no-store' });
        if (!cancelled) {
          setState({ orders: Array.isArray(data) ? data : [], loadedAt: Date.now(), error: null });
        }
      } catch (error) {
        // The list stays null on failure rather than becoming `[]`: an empty
        // array would render "No tickets yet" over a request that never
        // answered, which tells the buyer something untrue about their account.
        if (!cancelled) setState({ orders: null, loadedAt: 0, error });
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Memoised, or every render of this layout hands the context a new object and
  // re-renders all four consumers with identical data.
  const ordersValue = useMemo(() => ({ ...state, reload }), [state, reload]);

  /**
   * The badge on "My tickets": upcoming tickets, or nothing at all.
   *
   * `null` while the answer is unknown, never `0`. A badge that appears a moment
   * after the sidebar has painted moves every item under it down by its own
   * height, which happens while somebody is reaching for one of them.
   */
  const upcoming = state.orders
    ? summariseOrders(state.orders, state.loadedAt).upcomingCount
    : null;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AccountOrdersProvider value={ordersValue}>
          <AppShell
            workspace="Tickets"
            label="Your account"
            home="/account"
            groups={accountNavGroups({ upcoming })}
            tabKeys={ACCOUNT_TABS}
            /**
             * THE SWITCHER IS THE HEAD, which is the slot the organizer shell
             * deliberately empties.
             *
             * That decision was about "Create event" and the event switcher —
             * two controls an organizer reaches for constantly, which were
             * invisible on a phone because this panel is a drawer below `lg`.
             * They moved into the page.
             *
             * Switching workspace is the opposite kind of control: it is used
             * rarely, deliberately, and by the minority of accounts that have
             * somewhere to switch to. Behind the menu is the right place for it,
             * and it renders nothing at all for the accounts that do not.
             */
            head={<WorkspaceSwitcher />}
            foot={(
              <ShellFoot
                user={user}
                /**
                 * ONE LINK, where the old header had two buttons.
                 *
                 * The routes to the organizer dashboard and the admin console
                 * used to be here, as `es-btn`s in the page header. They are the
                 * switcher's job now, at the top of this panel, with the name of
                 * the surface they lead to and a line saying what is in it.
                 * Keeping a copy down here would be two controls doing one
                 * thing, in the two places somebody looks for different things.
                 */
                links={[{ href: '/', label: 'View the site', icon: 'globe' }]}
              />
            )}
          >
            {children}
          </AppShell>
        </AccountOrdersProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
