'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import { useCart, refreshCart } from '../../hooks/useCart';

/**
 * "You still have tickets held" — on the order confirmation (2026-11-17).
 *
 * A cart checks out one event at a time, so the moment one is paid for is the
 * moment to say what is left, before its hold runs out. Asks the server first:
 * the order just placed has left the cart, and an answer from before it would
 * count it again.
 */
export default function CartNudge() {
  const { count, items, loaded } = useCart();
  useEffect(() => { refreshCart(); }, []);
  if (!loaded || count === 0) return null;
  const events = items.length;
  return (
    <aside className="es-cartnudge" aria-label="Your cart">
      <span className="es-cartnudge__icon" aria-hidden="true"><NavIcon name="cart" size={20} /></span>
      <p className="fx-min0">
        <b>You still have {count} {count === 1 ? 'ticket' : 'tickets'} held</b>
        <span> for {events} more {events === 1 ? 'event' : 'events'}. Check {events === 1 ? 'it' : 'them'} out before the hold runs out.</span>
      </p>
      <Link href="/cart" className="es-btn es-btn--primary es-btn--sm">Go to cart<NavIcon name="arrow" size={16} /></Link>
    </aside>
  );
}
