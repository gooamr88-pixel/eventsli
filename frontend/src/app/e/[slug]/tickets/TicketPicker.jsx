'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { describeError, isSelectionLost, messageFor } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { put } from '../../../utils/apiClient';
import { useApi } from '../../../hooks/useApi';
import { useReservation } from '../../../hooks/useReservation';
import { Loading, Empty, ErrorNotice, Notice } from '../../../components/Feedback';
import NavIcon from '../../../components/shell/NavIcon';
import { useCart, refreshCart } from '../../../hooks/useCart';
import { useToast } from '../../../components/ui/Toast';
import { cartItemFor } from '../seats/cartSeats';
import BookTierCard from './BookTierCard';
import ExtrasList from './ExtrasList';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "BOOK YOUR TICKET" — general admission, chosen on the event page itself
 * (owner, 2026-11-22). Also the body of `/e/[slug]/tickets`.
 *
 * Each ticket type is a card with its details as a checklist and its own
 * quantity; the event's add-ons sit under the tickets ("Make it special"), so
 * they are chosen BEFORE checkout; one bar at the end holds the lot — "Add to
 * cart" to keep browsing, "Book now" to pay.
 *
 * NOTHING HERE PRICES ANYTHING. The running figure is ticket and add-on prices
 * times quantities, labelled "before fees"; the real total is the quote's.
 *
 * WHAT LIMITS A STEPPER, in the order it binds: what is left in that type, the
 * type's own per-order cap, the EVENT's cap across all types. `hold_general`
 * enforces all three again under a row lock; these stop a buyer before they
 * choose. Add-ons: one per ticket, never past what the organizer has left —
 * enforced again by `PUT /reservations/:id/addons`.
 *
 * `event` is the page's own copy when there is one (the event page renders it
 * on the server); without it the event is fetched by `slug`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TicketPicker({ slug, event: given = null, focusTierId = null }) {
  const router = useRouter();
  const { hold } = useReservation();
  const fetched = useApi(given ? null : `/public/events/${encodeURIComponent(slug)}`);
  const event = given || fetched.data;
  const reload = given ? () => router.refresh() : fetched.reload;
  const [counts, setCounts] = useState({});
  const [extras, setExtras] = useState({});
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const toast = useToast();

  /**
   * THE CART (2026-11-17). If this event is already in the cart, the counts
   * start from what it holds, and "Update cart" replaces that hold. The public
   * `remaining` leaves out the buyer's own held tickets, so they are added
   * back here: they are theirs to keep.
   */
  const { items: cartItems, count: cartCount } = useCart();
  const cartItem = cartItemFor(cartItems, slug);
  const heldQty = useMemo(
    () => Object.fromEntries((cartItem?.selection?.lines || []).map((l) => [l.tierId, l.quantity])),
    [cartItem],
  );
  const [seededFor, setSeededFor] = useState(null);
  if (cartItem && seededFor !== cartItem.reservationId) {
    setSeededFor(cartItem.reservationId);
    if (Object.keys(counts).length === 0 && Object.keys(heldQty).length) setCounts(heldQty);
  }
  const remainingOf = (tier) => (tier.remaining === null || tier.remaining === undefined
    ? null : tier.remaining + (heldQty[tier.id] || 0));

  const tiers = useMemo(() => event?.tiers || [], [event]);
  const addons = useMemo(() => (Array.isArray(event?.addons) ? event.addons : []), [event]);
  const maxPerOrder = event?.maxTicketsPerOrder || 10;
  const chosen = Object.values(counts).reduce((n, q) => n + q, 0);
  // Extras never outnumber tickets: stepping tickets down trims them on read.
  const extraQty = (id) => Math.min(extras[id] || 0, chosen);
  const extrasChosen = addons.reduce((n, a) => n + extraQty(a.id), 0);
  const subtotal = tiers.reduce((sum, t) => sum + (counts[t.id] || 0) * t.priceCents, 0)
    + addons.reduce((sum, a) => sum + extraQty(a.id) * a.priceCents, 0);
  const everythingFree = tiers.length > 0 && tiers.every((t) => t.priceCents === 0);

  if (!event && fetched.loading) return <Loading variant="card" label="Loading tickets" />;
  if (!event && fetched.error) return <ErrorNotice error={fetched.error} onRetry={reload} action={{ href: `/e/${slug}`, label: 'Back to the event' }} />;
  if (tiers.length === 0) {
    return <Empty icon="ticket" title="No tickets yet" hint="The organizer has not put tickets on sale for this event." />;
  }

  /** What one more of this type would be refused for, or null. */
  function blockedReason(tier) {
    const current = counts[tier.id] || 0;
    if (remainingOf(tier) !== null && current >= remainingOf(tier)) return 'That is all that is left.';
    const own = tier.maxPerOrder;
    if (own !== null && own !== undefined && current >= own) return `Up to ${own} of this type in one order.`;
    if (chosen >= maxPerOrder) return `Up to ${maxPerOrder} tickets in one order.`;
    return null;
  }

  function change(tier, delta) {
    setActionError(null);
    setCounts((c) => {
      const next = (c[tier.id] || 0) + delta;
      if (next <= 0) {
        const { [tier.id]: _removed, ...rest } = c;
        return rest;
      }
      return { ...c, [tier.id]: next };
    });
  }

  function setExtra(id, quantity) {
    setActionError(null);
    setExtras((x) => ({ ...x, [id]: Math.max(0, Math.min(quantity, chosen)) }));
  }

  /** Holds the tickets (and the extras) — then stays (`cart`) or goes to pay. */
  async function submit(mode) {
    if (chosen === 0) return;
    setBusy(mode);
    setActionError(null);
    try {
      const lines = Object.entries(counts)
        .filter(([, quantity]) => quantity > 0)
        .map(([tierId, quantity]) => ({ tierId, quantity }));

      const reservation = await hold(slug, { lines }, {
        replaces: cartItem ? { reservationId: cartItem.reservationId, reservationToken: cartItem.reservationToken } : null,
      });

      const addonLines = addons
        .map((a) => ({ addonId: a.id, quantity: extraQty(a.id) }))
        .filter((l) => l.quantity > 0);
      if (addonLines.length > 0) {
        await put(
          `/public/reservations/${reservation.reservationId}/addons`,
          { lines: addonLines },
          { headers: { 'x-access-token': reservation.reservationToken }, noRedirect: true },
        );
      }

      if (mode === 'cart') {
        toast.success(cartItem ? 'Your cart is updated. The tickets are held for you.' : 'Added to your cart. The tickets are held for you.', {
          title: cartItem ? 'Cart updated' : 'Added to cart',
        });
        setSeededFor(reservation.reservationId);
        await refreshCart();
        reload();
        setBusy(null);
        return;
      }
      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
      if (err?.meta?.restored) refreshCart();
      setActionError(err);
      // Somebody took the last of a type between the render and the hold: the
      // numbers on screen are wrong, so they are re-read and the choice cleared.
      if (isSelectionLost(err?.code)) {
        setCounts({});
        reload();
      }
      setBusy(null);
    }
  }

  const extraRows = addons.map((a) => {
    const mine = extraQty(a.id);
    const left = a.remaining === null || a.remaining === undefined ? null : a.remaining;
    return {
      ...a,
      mine,
      ceiling: left === null ? chosen : Math.min(chosen, left),
      soldOut: left === 0,
      note: left !== null && left > 0 && left <= 10 ? `only ${left} left` : null,
    };
  });
  const figure = chosen === 0 && !everythingFree
    ? null
    : subtotal === 0 ? 'Free' : formatMoney(subtotal, event.currency);

  return (
    <div className="es-book">
      <ul className="es-book__tiers">
        {tiers.map((tier) => (
          <BookTierCard
            key={tier.id}
            tier={tier}
            currency={event.currency}
            timeZone={event.timezone}
            count={counts[tier.id] || 0}
            blocked={blockedReason(tier)}
            busy={Boolean(busy)}
            focused={focusTierId === tier.id}
            onPlus={() => change(tier, 1)}
            onMinus={() => change(tier, -1)}
          />
        ))}
      </ul>

      <ExtrasList
        rows={extraRows}
        currency={event.currency}
        organizerName={event.organizer?.name}
        tickets={chosen}
        disabled={chosen === 0 || Boolean(busy)}
        onSet={setExtra}
        lockedHint={chosen === 0 ? 'Choose a ticket first, then add extras to it.' : null}
      />

      {actionError && (
        <Notice tone="danger" title={describeError(actionError).title}>
          <p>{messageFor(actionError)}</p>
        </Notice>
      )}

      {/* Sticky on a phone so the total and the buttons stay in reach while
          quantities change; static from lg, at the end of the list. The
          bottom padding clears the iPhone home indicator. */}
      <div className="es-book__bar">
        <div className="es-book__sum">
          <div className="fx-min0">
            <p className="es-book__count">
              {chosen} {chosen === 1 ? 'ticket' : 'tickets'}
              {extrasChosen > 0 && <span> · {extrasChosen} {extrasChosen === 1 ? 'extra' : 'extras'}</span>}
            </p>
            {subtotal > 0 && (
              <p className="es-book__fine">Before booking fees and tax, which are shown at the checkout.</p>
            )}
          </div>
          <p className="es-book__total es-nums">{figure}</p>
        </div>

        <div className="es-book__actions">
          <button
            type="button"
            onClick={() => submit('cart')}
            disabled={chosen === 0 || Boolean(busy)}
            className="es-book__btn es-book__btn--ghost"
          >
            <NavIcon name="cart" size={19} />
            {busy === 'cart' ? 'Adding…' : cartItem ? 'Update cart' : 'Add to cart'}
          </button>
          <button
            type="button"
            onClick={() => submit('checkout')}
            disabled={chosen === 0 || Boolean(busy)}
            className="es-book__btn es-book__btn--main"
          >
            {busy === 'checkout' ? 'Holding…' : chosen === 0 ? 'Choose your tickets' : 'Book now'}
            {chosen > 0 && busy !== 'checkout' && <NavIcon name="arrow" size={19} />}
          </button>
        </div>

        <p className="es-book__meta">
          <span><NavIcon name="lock" size={14} />Secure checkout</span>
          <span>Up to {maxPerOrder} tickets per order</span>
          {cartCount > 0 && (
            <Link href="/cart" className="es-book__cartlink">
              View cart ({cartCount})
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
