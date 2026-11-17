'use client';

import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import { useCart } from '../../hooks/useCart';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The cart in the header (2026-11-17): an icon that is always there, with the
 * number of tickets held as a badge once there are any. The link's name says
 * the count in words, so a screen reader hears "Cart, 3 tickets held" rather
 * than "Cart, 3".
 *
 * No timer here, deliberately: a countdown ticking in every page's header is
 * anxiety on every page. The deadlines are on the cart page, per event, where
 * the buyer is deciding.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CartButton({ className = '' }) {
  const { count } = useCart();
  const label = count > 0 ? `Cart, ${count} ${count === 1 ? 'ticket' : 'tickets'} held` : 'Cart, empty';
  return (
    <Link href="/cart" className={`es-cartbtn ${className}`} aria-label={label} title={label}>
      <NavIcon name="cart" size={20} />
      {count > 0 && <span className="es-cartbtn__badge es-nums" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
