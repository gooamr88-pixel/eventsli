'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavIcon from './NavIcon';
import { useAuth } from '../../hooks/useAuth';
import { switchTargets, workspaceOf, WORKSPACE_LABEL } from '../../lib/workspaces';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAY BETWEEN THE SURFACES ONE ACCOUNT HAS.
 *
 * The product already let an account be a buyer and an organizer — the API has
 * stored both in `account_types` since sign-up existed, and Eventsli's own staff
 * are admins who also run events on the platform. What it did not have was a way
 * to move between them that reads as moving.
 *
 * WHAT THIS REPLACES. Three one-off links, each in a different place, each
 * phrased differently, and none of them in the buyer's half at all:
 *
 *   organizer/layout   ShellFoot link, "Admin console",        admins only
 *   admin/layout       ShellFoot link, "Organizer dashboard",  organizers only
 *   account/layout     two header buttons, "Console" and "Organizer dashboard"
 *
 * The footer of a sidebar is where "sign out" and "view the site" live — the
 * things you do when you are leaving. Changing which half of the product you are
 * working in is the opposite of leaving, and it was filed with the exits. On a
 * phone it was worse than misfiled: the sidebar is a drawer below `lg`, so both
 * links were behind a menu, at the bottom, under the sign-out.
 *
 * It is ONE control now, at the TOP of the sidebar, under the name of the
 * workspace you are in — so "where am I" and "where else could I be" are read
 * together, in that order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT A DROPDOWN, and that is a deliberate refusal of the obvious shape.
 *
 * Every product with a workspace switcher has a menu button, and a menu is the
 * right answer at twenty workspaces. There are at most three here and usually
 * two, so a menu would add a press, a popover, an expanded state, an outside
 * click, its own focus trap and its own Escape — the whole apparatus — to save
 * one row of vertical space in a panel that has room.
 *
 * Plain links instead: middle-click and "open in new tab" work, there is no
 * state to get stuck open, and no keyboard behaviour to implement or get wrong.
 * `AppShell`'s drawer already closes itself on a route change, so a tap here on
 * a phone lands on the new workspace with the drawer shut.
 *
 * RENDERS NOTHING FOR ONE WORKSPACE, which is most accounts. A switcher offering
 * nowhere to switch to is a control that teaches people the control does not
 * work. The heading that says where you are is `AppShell`'s, not this — so an
 * ordinary buyer still gets told which surface they are on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function WorkspaceSwitcher() {
  const pathname = usePathname() || '';
  const { user, loading } = useAuth();

  /**
   * Nothing while the answer is in flight, and nothing when there is one
   * workspace.
   *
   * Guessing and correcting is the bug `useAuth`'s own header note describes:
   * an admin-and-organizer opening the console would get a sidebar with no
   * switcher, then a switcher a moment later, which moves every item under it
   * down by a row while they are reaching for one.
   */
  if (loading || !user) return null;

  const targets = switchTargets(user, pathname);
  if (targets.length === 0) return null;

  const here = workspaceOf(pathname);

  return (
    <div className="es-wsw">
      {/*
        THE HEADING NAMES WHAT YOU WOULD BE LEAVING, not what the rows are.
        "Switch workspace" over a list of two would be a label describing the
        control; "You are in Organizer" describes the situation, which is the
        thing somebody arriving here does not know.
      */}
      {/*
        `.es-nav__rail-hide` is the shell's existing handle for "not on the
        tablet icon rail", where the panel is 64px wide and a sentence has
        nowhere to go. The rail keeps the icon and the accessible name, so the
        control still works there — it just stops trying to explain itself.
      */}
      <p className="es-wsw__label es-nav__rail-hide" id="es-wsw-label">
        {here ? `You are in ${WORKSPACE_LABEL[here]}` : 'Your workspaces'}
      </p>

      <ul className="es-wsw__list" aria-labelledby="es-wsw-label">
        {targets.map((target) => (
          <li key={target.key}>
            {/*
              `aria-label` carries the whole sentence because the visible text is
              split across two spans and the rail hides one of them. Without it,
              the rail announces "Admin, link" — which does not say that pressing
              it changes which half of the product you are in.
            */}
            <Link
              href={target.href}
              className="es-wsw__item"
              aria-label={`Switch to ${target.label} — ${target.blurb}`}
            >
              <span className="es-wsw__icon" aria-hidden="true">
                <NavIcon name={target.icon} size={18} />
              </span>
              {/* `aria-hidden`, because `aria-label` above already says all of
                  it. Left visible and unhidden, a reader hears the workspace
                  name twice. */}
              <span className="es-wsw__text es-nav__rail-hide" aria-hidden="true">
                <span className="es-wsw__name">{target.label}</span>
                <span className="es-wsw__blurb">{target.blurb}</span>
              </span>
              <span className="es-wsw__go es-nav__rail-hide" aria-hidden="true">
                <NavIcon name="arrow" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
