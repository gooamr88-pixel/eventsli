'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError, isSelectionLost, messageFor } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { useApi } from '../../../hooks/useApi';
import { useReservation } from '../../../hooks/useReservation';
import { Loading, Empty, ErrorNotice, Notice } from '../../../components/Feedback';
import NavIcon from '../../../components/shell/NavIcon';
import TierDetailsDialog, { hasDetails } from '../../../components/tickets/TierDetailsDialog';
import Link from 'next/link';
import { useCart, refreshCart } from '../../../hooks/useCart';
import { useToast } from '../../../components/ui/Toast';
import { cartItemFor } from '../seats/cartSeats';
import { formatEventTime } from '../../../lib/eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * General admission: how many of each ticket type.
 *
 * NOTHING HERE PRICES ANYTHING. The running total is the sum of the ticket
 * prices and is labelled as such; the real total comes back from the quote
 * AFTER the hold, with the taxes and fees this page is in no position to
 * compute. That is the same rule the seat picker follows, for the same reason:
 * two places that both calculate money are two places that can disagree about
 * what somebody owes.
 *
 * WHAT LIMITS A STEPPER, in the order it binds:
 *
 *   • how many are left in that type (`remaining`, null = uncapped);
 *   • that type's own cap on one order (`maxPerOrder`);
 *   • the EVENT's cap across all types, which is what stops somebody taking
 *     ten of each of four types on an event that allows ten in total.
 *
 * All three are enforced again inside `hold_general`, under a row lock. These
 * exist so a buyer is stopped before they have chosen, not after — the server
 * is the authority, this is the explanation.
 *
 * A SOLD-OUT OR NOT-YET-OPEN TYPE IS SHOWN, NOT HIDDEN. "Early bird — from
 * Friday" is a reason to come back; a type that quietly is not there reads as
 * an event with less on offer than it has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TicketPicker({ slug, focusTierId }) {
  const router = useRouter();
  const { hold } = useReservation();
  const { data: event, error, loading, reload } = useApi(`/public/events/${encodeURIComponent(slug)}`);
  const [counts, setCounts] = useState({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  // The ticket type whose details card is open. A "show before buying" card
  // opens on "+" for as long as none of that type is chosen.
  const [detailsId, setDetailsId] = useState(null);
  const toast = useToast();

  /**
   * THE CART (2026-11-17). If this event is already in the cart, the counts
   * start from what it holds, and "Update cart" replaces that hold with the
   * new counts. The public `remaining` leaves out the buyer's own held
   * tickets, so they are added back here: they are theirs to keep.
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
  const maxPerOrder = event?.maxTicketsPerOrder || 10;

  const chosen = useMemo(
    () => Object.values(counts).reduce((n, q) => n + q, 0),
    [counts],
  );

  const subtotal = useMemo(
    () => tiers.reduce((sum, t) => sum + (counts[t.id] || 0) * t.priceCents, 0),
    [tiers, counts],
  );

  const everythingFree = tiers.length > 0 && tiers.every((t) => t.priceCents === 0);

  if (loading && !event) return <Loading variant="card" label="Loading tickets" />;
  if (error && !event) return <ErrorNotice error={error} onRetry={reload} action={{ href: `/e/${slug}`, label: 'Back to the event' }} />;
  if (tiers.length === 0) {
    return <Empty icon="ticket" title="No tickets yet" hint="The organizer has not put tickets on sale for this event." />;
  }

  /** What one more of this type would be refused for, or null. */
  function blockedReason(tier) {
    const current = counts[tier.id] || 0;
    if (remainingOf(tier) !== null && current >= remainingOf(tier)) return 'That is all that is left.';
    const own = tier.maxPerOrder;
    if (own !== null && own !== undefined && current >= own) {
      return `Up to ${own} of this type in one order.`;
    }
    if (chosen >= maxPerOrder) return `Up to ${maxPerOrder} tickets in one order.`;
    return null;
  }

  /** How many more of this type one order can still take. */
  function roomFor(tier) {
    const current = counts[tier.id] || 0;
    const limits = [maxPerOrder - chosen];
    if (remainingOf(tier) !== null) limits.push(remainingOf(tier) - current);
    if (tier.maxPerOrder !== null && tier.maxPerOrder !== undefined) limits.push(tier.maxPerOrder - current);
    return Math.max(0, Math.min(...limits));
  }

  function closeDetails() {
    setDetailsId(null);
  }

  function addFromDetails(tier, quantity) {
    const n = Math.min(quantity, roomFor(tier));
    if (n > 0) change(tier, n);
    closeDetails();
  }

  function plus(tier) {
    if (tier.details?.showBeforeBuying && hasDetails(tier) && !(counts[tier.id] > 0)) {
      setDetailsId(tier.id);
      return;
    }
    change(tier, 1);
  }

  function change(tier, delta) {
    setActionError(null);
    setCounts((c) => {
      const current = c[tier.id] || 0;
      const next = current + delta;
      if (next <= 0) {
        const { [tier.id]: _removed, ...rest } = c;
        return rest;
      }
      return { ...c, [tier.id]: next };
    });
  }

  /** Holds the counts into the cart — then stays (`cart`) or goes to pay (`checkout`). */
  async function submit(mode = 'checkout') {
    if (chosen === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const lines = Object.entries(counts)
        .filter(([, quantity]) => quantity > 0)
        .map(([tierId, quantity]) => ({ tierId, quantity }));

      const reservation = await hold(slug, { lines }, {
        replaces: cartItem ? { reservationId: cartItem.reservationId, reservationToken: cartItem.reservationToken } : null,
      });
      if (mode === 'cart') {
        toast.success(cartItem ? 'Your cart is updated. The tickets are held for you.' : 'Added to your cart. The tickets are held for you.', {
          title: cartItem ? 'Cart updated' : 'Added to cart',
        });
        setSeededFor(reservation.reservationId);
        await refreshCart();
        reload();
        setBusy(false);
        return;
      }
      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
      // A refused replace put the original hold back; the cart shows it again.
      if (err?.meta?.restored) refreshCart();
      setActionError(err);
      /**
       * Somebody else took the last of a type between the render and the hold.
       * The numbers on screen are now wrong, so they are re-read — and the
       * selection is cleared rather than kept, because a quantity the buyer
       * chose against stale availability is not a choice they would make again.
       */
      if (isSelectionLost(err?.code)) {
        setCounts({});
        reload();
      }
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <ul className="fx-stack fx-stack--sm">
        {tiers.map((tier) => {
          const count = counts[tier.id] || 0;
          const unavailable = tier.soldOut || !tier.onSale;
          const blocked = blockedReason(tier);

          return (
            <li
              key={tier.id}
              className={`es-plate fx-row fx-row--between flex-wrap items-center gap-4 p-4 ${
                focusTierId === tier.id ? 'border-accent' : ''
              }`}
            >
              {/* A 12rem floor before the stepper is allowed beside it. With a
                  bare `flex-1` the text could shrink to nothing, so on a 320px
                  phone the stepper stayed on the line and the description ran
                  down a 100px column, five lines for one sentence. Now the
                  stepper drops under it when there is not room for both. */}
              <div className="fx-min0 flex-[1_1_12rem]">
                <p className="text-ink">
                  {tier.name}
                  {tier.kind === 'vip' && <span className="es-pill es-pill--accent ml-2">VIP</span>}
                  {tier.kind === 'early_bird' && <span className="es-pill ml-2">Early bird</span>}
                </p>
                {(tier.details?.tagline || tier.description) && (
                  <p className="text-sm text-subtle">{tier.details?.tagline || tier.description}</p>
                )}
                {hasDetails(tier) && (
                  <button type="button" className="es-tdx-open mt-2" onClick={() => setDetailsId(tier.id)}>
                    <NavIcon name="info" size={14} />What’s included<span className="sr-only"> in {tier.name}</span>
                  </button>
                )}
                <p className="es-nums mt-1 text-md font-medium text-ink">
                  {tier.priceCents === 0 ? 'Free' : formatMoney(tier.priceCents, event.currency)}
                </p>
                <TierStatus tier={tier} timeZone={event.timezone} />
              </div>

              {unavailable ? (
                <span className="es-pill shrink-0">{tier.soldOut ? 'Sold out' : 'Not on sale'}</span>
              ) : (
                <div className="fx-row ml-auto shrink-0 items-center gap-2">
                  <StepButton
                    onClick={() => change(tier, -1)}
                    disabled={count === 0 || busy}
                    label={`One fewer ${tier.name}`}
                  >
                    −
                  </StepButton>
                  <span className="es-nums w-8 text-center text-md text-ink" aria-live="polite">
                    {count}
                  </span>
                  <StepButton
                    onClick={() => plus(tier)}
                    disabled={Boolean(blocked) || busy}
                    label={`One more ${tier.name}`}
                    title={blocked || undefined}
                  >
                    +
                  </StepButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {(() => {
        const tier = detailsId ? tiers.find((t) => t.id === detailsId) : null;
        if (!tier) return null;
        const room = roomFor(tier);
        const unavailable = tier.soldOut ? 'Sold out.'
          : tier.notYetOnSale && tier.salesStartAt
            ? `On sale from ${formatEventTime(tier.salesStartAt, event.timezone)}.`
            : !tier.onSale ? 'No longer on sale.'
              : room === 0 ? blockedReason(tier) : null;
        return (
          <TierDetailsDialog
            key={tier.id}
            tier={tier}
            currency={event.currency}
            max={room}
            unavailable={unavailable}
            onAdd={(q) => addFromDetails(tier, q)}
            onClose={closeDetails}
            footnote={`Up to ${maxPerOrder} tickets per order · fees and tax are shown at checkout`}
          />
        );
      })()}

      {actionError && (
        <Notice tone="danger" title={describeError(actionError).title}>
          <p>{messageFor(actionError)}</p>
        </Notice>
      )}

      {/**
        * STICKY ON A PHONE, like the seat picker's selection bar — the two
        * guest paths behaved differently for no reason anybody chose.
        *
        * On `/seats` the running total and Continue are pinned, because the map
        * fills the screen. Here they were the last block after the tier list,
        * so on an event with six ticket types the total moved off screen as
        * soon as somebody started tapping "+" — they were choosing quantities
        * with the number those quantities produce nowhere in view.
        *
        * The bottom padding clears the iPhone home indicator; `bottom-0` is
        * enough because this is the last block in its own scrolling column.
        * Not `.fx-safe-bottom` + `p-4`: the utility's padding beat the
        * component class, so the clearance was zero and Checkout sat under
        * the home bar (2026-11-19).
        */}
      <div className="sticky bottom-0 z-(--es-z-sticky) es-plate fx-stack fx-stack--sm bg-surface px-4 pt-4 pb-[max(1rem,calc(var(--fx-safe-b)_+_0.5rem))] shadow-lg lg:static lg:shadow-none">
        <div className="fx-row fx-row--between items-baseline gap-3">
          <span className="text-ink">
            {chosen} {chosen === 1 ? 'ticket' : 'tickets'}
          </span>
          {/* Nothing chosen on a paid event is no amount, not "Free" — that read
              as a claim about the event before a single ticket was picked. */}
          <span className="es-nums text-lg font-medium text-ink">
            {chosen === 0 && !everythingFree
              ? null
              : everythingFree || subtotal === 0 ? 'Free' : formatMoney(subtotal, event.currency)}
          </span>
        </div>

        {/* Said before the hold, not after the quote. Somebody choosing four
            tickets should know the number will grow before they see it grow. */}
        {subtotal > 0 && (
          <p className="text-xs text-subtle">
            Tickets only. Any taxes and booking fees are shown at the checkout.
          </p>
        )}

        <button
          type="button"
          onClick={() => submit('checkout')}
          disabled={chosen === 0 || busy}
          className="es-btn es-btn--primary es-btn--block es-btn--lg"
        >
          {busy ? 'Holding…' : chosen === 0 ? 'Choose your tickets' : 'Checkout'}
        </button>
        {/* The cart (2026-11-17): hold these and keep browsing other events. */}
        <button
          type="button"
          onClick={() => submit('cart')}
          disabled={chosen === 0 || busy}
          className="es-btn es-btn--secondary es-btn--block"
        >
          <NavIcon name="cart" size={18} />{cartItem ? 'Update cart' : 'Add to cart'}
        </button>
        {cartCount > 0 && (
          <Link href="/cart" className="es-basket__cartlink">
            <NavIcon name="cart" size={16} />View cart ({cartCount} {cartCount === 1 ? 'ticket' : 'tickets'})
          </Link>
        )}

        <p className="text-center text-xs text-subtle">
          Up to {maxPerOrder} tickets per order · held for 35 minutes once you continue
        </p>
      </div>
    </div>
  );
}

/**
 * The one line under a ticket type that says where it stands.
 *
 * "Not on sale yet" and "sold out" are deliberately different sentences, not
 * one "unavailable": the first is an invitation to come back and the second is
 * not, and collapsing them tells somebody an early-bird type is gone when it
 * has not opened.
 */
/** Sale windows are on the VENUE's clock, labelled — as every event time is. */
function TierStatus({ tier, timeZone }) {
  // Nothing here for a sold-out type: the pill beside it already says so, and
  // saying it twice in one row reads as two different facts.
  if (tier.soldOut) return null;

  if (tier.notYetOnSale && tier.salesStartAt) {
    return (
      <p className="text-sm text-subtle">
        On sale from {formatEventTime(tier.salesStartAt, timeZone)}
      </p>
    );
  }

  if (tier.salesEnded) return <p className="text-sm text-subtle">No longer on sale</p>;

  // Only when it is genuinely nearly gone. A live count on a type with two
  // hundred left is noise, and on one with three left it is the reason
  // somebody stops deliberating.
  if (tier.remaining !== null && tier.remaining <= 10) {
    return (
      <p className="text-sm text-warning">
        Only {tier.remaining} left
      </p>
    );
  }

  if (tier.salesEndAt) {
    return (
      <p className="text-sm text-subtle">
        Until {formatEventTime(tier.salesEndAt, timeZone)}
      </p>
    );
  }

  return null;
}

function StepButton({ onClick, disabled, label, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      // 44px: the smallest square a thumb hits reliably, and these are tapped
      // repeatedly rather than once.
      className="grid h-11 w-11 place-items-center rounded-full border border-border-strong text-lg text-ink transition-colors hover:bg-bg-sunken disabled:opacity-40"
    >
      {children}
    </button>
  );
}
