'use client';

import Link from 'next/link';
import NavIcon from './NavIcon';
import LogoutButton from '../auth/LogoutConfirm';

/**
 * The bottom of the sidebar: who is signed in, the way to the other side of the
 * product, back to the site, and out.
 *
 * Signing out is here because it was on no organizer page at all — the only
 * sign-out lived in the site header, which the dashboard shell replaces.
 *
 * The account line exists because neither console said WHOSE console it was.
 * An admin who is also an organizer switches between the two from here, and
 * a shared laptop at a venue office is a real place this gets opened.
 */
export default function ShellFoot({ links = [], user }) {
  return (
    <>
      {user && (
        <div className="es-account" title={user.email}>
          <span className="es-avatar" aria-hidden="true">{initials(user)}</span>
          <span className="es-account__text es-nav__rail-hide">
            <span className="es-account__name">{user.fullName || 'Signed in'}</span>
            <span className="es-account__email">{user.email}</span>
          </span>
        </div>
      )}
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="es-nav__item">
          <span className="es-nav__icon"><NavIcon name={link.icon} /></span>
          <span className="es-nav__label">{link.label}</span>
        </Link>
      ))}
      {/* The same component the site header uses, so the question, the
          destructive styling and the busy state cannot drift between the two
          places somebody signs out. It keeps this row's nav-item furniture;
          only the confirmation is shared. */}
      <LogoutButton className="es-nav__item" next="/">
        <span className="es-nav__icon"><NavIcon name="exit" /></span>
        <span className="es-nav__label">Sign out</span>
      </LogoutButton>
    </>
  );
}

/* THE THEME ROW WAS HERE, and it is gone with the theme.

   It cycled system / light / dark from the shell's footer. The product has one
   palette now; the only dark surface left is `.fx-gate`, which the door
   scanner pins for itself and nobody chooses. */

/** "Yousef Amr" → "YA"; an account with no name → the first letter of the email. */
export function initials({ fullName, email } = {}) {
  const name = String(fullName || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
  }
  return String(email || '?').trim().charAt(0).toUpperCase() || '?';
}
