'use client';

import Link from 'next/link';
import NavIcon from './NavIcon';
import { signOut } from '../../hooks/useAuth';

/**
 * The bottom of the sidebar: the way to the other side of the product, back to
 * the site, and out.
 *
 * Signing out is here because it was on no organizer page at all — the only
 * sign-out lived in the site header, which the dashboard shell replaces.
 */
export default function ShellFoot({ links = [] }) {
  return (
    <>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="es-nav__item">
          <span className="es-nav__icon"><NavIcon name={link.icon} /></span>
          <span className="es-nav__label">{link.label}</span>
        </Link>
      ))}
      <button type="button" className="es-nav__item" onClick={() => signOut('/')}>
        <span className="es-nav__icon"><NavIcon name="exit" /></span>
        <span className="es-nav__label">Sign out</span>
      </button>
    </>
  );
}
