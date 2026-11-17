'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '../hooks/useCart';
import { useReservation } from '../hooks/useReservation';
import { useConfirm } from '../components/ui/Confirm';
import { Loading, ErrorNotice, Notice } from '../components/Feedback';
import NavIcon from '../components/shell/NavIcon';
import { formatMoney } from '../utils/money';
import { formatEventTime } from '../lib/eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CART PAGE (owner, 2026-11-17).
 *
 * Grouped by ORGANIZER, because that is how it is paid: a card payment goes to
 * one organizer's own account, so each group is its own payment. Inside a
 * group, each event shows what is held, its total with fees and tax (the same
 * quote the checkout charges), and how long the hold has left.
 *
 * Every event here is HELD — nobody else can take those seats until the clock
 * runs out. A hold that lapses while the page is open leaves it, and the page
 * says which one went.
 *
 * Phase 1: each event checks out on its own (its seats, its signature, its
 * payment), and the buyer's details are kept between them. Paying for several
 * events from one organizer in a single payment is phase 2.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CartClient() {
  const cart = useCart();
  const now = useNowSecond();
  const [goneSeen, setGoneSeen] = useState([]);

  // Holds the server reported gone, kept for this visit so the notice does not
  // vanish on the next refresh. Bought ones are not news here.
  const fresh = (cart.gone || []).filter((g) => g.reason !== 'purchased' && !goneSeen.some((s) => s.reservationId === g.reservationId));
  if (fresh.length) setGoneSeen([...goneSeen, ...fresh]);

  if (!cart.loaded) return <Loading variant="card" label="Loading your cart" />;
  if (cart.error && cart.items.length === 0) return <ErrorNotice error={cart.error} onRetry={cart.refresh} />;

  const totalTickets = cart.count;
  return (
    <div className="es-cart fx-stack">
      <header className="es-cart__head">
        <div className="fx-min0">
          <p className="es-eyebrow">Your cart</p>
          <h1 className="es-cart__title">
            {totalTickets > 0 ? `${totalTickets} ${totalTickets === 1 ? 'ticket' : 'tickets'} held for you` : 'Your cart is empty'}
          </h1>
          {totalTickets > 0 && (
            <p className="es-cart__lede">
              Nobody else can take these until each hold&rsquo;s timer runs out. Check out each organizer&rsquo;s tickets before then.
            </p>
          )}
        </div>
        <Link href="/events" className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="search" size={16} />Keep browsing
        </Link>
      </header>

      {goneSeen.length > 0 && (
        <Notice tone="warning" title={goneSeen.length === 1 ? 'One hold ran out' : `${goneSeen.length} holds ran out`}>
          <p>
            Those tickets went back on sale and left your cart. If you still want them, choose them again —
            they may still be available.
          </p>
          <div className="fx-row pt-1">
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setGoneSeen([])}>Dismiss</button>
          </div>
        </Notice>
      )}

      {cart.items.length === 0 ? (
        <section className="es-cart__empty">
          <span className="es-cart__emptyicon" aria-hidden="true"><NavIcon name="cart" size={34} /></span>
          <p className="es-cart__emptytitle">Nothing held yet</p>
          <p className="es-cart__emptytext">
            Choose seats or tickets on any event and press <b>Add to cart</b> — they are held for you while you keep
            looking.
          </p>
          <Link href="/events" className="es-btn es-btn--primary">Find events</Link>
        </section>
      ) : (
        cart.groups.map((group) => (
          <OrganizerGroup key={`${group.organizer.id}-${group.currency}`} group={group} now={now} onRemove={cart.remove} refresh={cart.refresh} />
        ))
      )}

      {cart.items.length > 0 && (
        <p className="es-cart__foot">
          <NavIcon name="shield" size={16} />
          Card payments are processed by Stripe and go straight to each organizer. Fees and tax are included in every total.
        </p>
      )}
    </div>
  );
}

function OrganizerGroup({ group, now, onRemove, refresh }) {
  const many = group.items.length > 1;
  return (
    <section className="es-cartgroup" aria-label={`Tickets from ${group.organizer.name}`}>
      <div className="es-cartgroup__head">
        <span className="es-cartgroup__seller">
          <NavIcon name="store" size={18} />
          Sold by <b>{group.organizer.name}</b>
        </span>
        <span className="es-cartgroup__total es-nums">{formatMoney(group.totalCents, group.currency)}</span>
      </div>
      {many && (
        <p className="es-cartgroup__note">
          <NavIcon name="info" size={14} /> {group.items.length} events from this organizer — each one checks out on its own, and your details are kept between them.
        </p>
      )}
      <ul className="es-cartgroup__items">
        {group.items.map((item) => (
          <CartItem key={item.reservationId} item={item} now={now} onRemove={onRemove} refresh={refresh} />
        ))}
      </ul>
    </section>
  );
}

function CartItem({ item, now, onRemove, refresh }) {
  const router = useRouter();
  const { select } = useReservation();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const left = now === null ? null : Math.max(0, Date.parse(item.expiresAt) - now);
  const expired = left === 0;
  const askedFor = useRef(false);

  // The moment a hold runs out, ask the server once: it leaves the cart then,
  // with the "ran out" notice, rather than sitting here at 0:00.
  useEffect(() => {
    if (expired && !askedFor.current) { askedFor.current = true; refresh(); }
  }, [expired, refresh]);

  const editHref = item.selection?.lines ? `/e/${item.event.slug}/tickets` : `/e/${item.event.slug}/seats`;
  const when = item.event.startsAt ? formatEventTime(item.event.startsAt, item.event.timezone) : null;
  const where = [item.event.venue, item.event.city].filter(Boolean).join(', ');

  async function remove() {
    const ok = await confirm({
      title: `Remove ${item.event.title}?`,
      body: <p>The {item.ticketCount === 1 ? 'ticket goes' : `${item.ticketCount} tickets go`} back on sale straight away, and someone else may take {item.ticketCount === 1 ? 'it' : 'them'}.</p>,
      confirmLabel: 'Remove from cart',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('remove');
    try { await onRemove(item); } finally { setBusy(null); }
  }

  function checkout() {
    setBusy('checkout');
    select(item);
    router.push(`/checkout/${item.reservationId}`);
  }

  return (
    <li className="es-cartitem">
      <Link href={`/e/${item.event.slug}`} className="es-cartitem__cover" tabIndex={-1} aria-hidden="true">
        {item.event.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- the organizer's cover, from our storage
          ? <img src={item.event.coverUrl} alt="" loading="lazy" />
          : <span className="es-cartitem__nocover"><NavIcon name="ticket" size={28} /></span>}
      </Link>

      <div className="es-cartitem__body">
        <div className="es-cartitem__top">
          <div className="fx-min0">
            <h2 className="es-cartitem__title"><Link href={`/e/${item.event.slug}`}>{item.event.title}</Link></h2>
            <p className="es-cartitem__meta">
              {when && <span><NavIcon name="calendar" size={14} />{when}</span>}
              {where && <span className="fx-min0"><NavIcon name="pin" size={14} /><span className="fx-truncate">{where}</span></span>}
            </p>
          </div>
          <HoldTimer left={left} />
        </div>

        <ul className="es-cartitem__lines">
          {item.lines.map((line, i) => (
            <li key={`${line.label}-${i}`}>
              <span className="fx-min0">
                <b>{line.kind === 'table' ? line.label : `${line.label} × ${line.quantity}`}</b>
                {line.kind === 'table' && line.seats ? <small>{line.seats} seats, booked as one table</small> : null}
                {line.kind === 'seats' && line.places?.length ? <small>Seats {line.places.join(', ')}</small> : null}
              </span>
              {line.amountCents !== null && line.amountCents !== undefined && (
                <span className="es-nums">{formatMoney(line.amountCents, item.currency)}</span>
              )}
            </li>
          ))}
        </ul>

        <dl className="es-cartitem__sum">
          {item.discountCents > 0 && <div><dt>Discount</dt><dd className="es-nums">−{formatMoney(item.discountCents, item.currency)}</dd></div>}
          {item.feesCents > 0 && <div><dt>Fees and tax</dt><dd className="es-nums">{formatMoney(item.feesCents, item.currency)}</dd></div>}
          <div className="es-cartitem__total"><dt>Total</dt><dd className="es-nums">{item.totalCents === 0 ? 'Free' : formatMoney(item.totalCents, item.currency)}</dd></div>
        </dl>

        <div className="es-cartitem__actions">
          <Link href={editHref} className="es-btn es-btn--ghost es-btn--sm"><NavIcon name="pencil" size={16} />Change</Link>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={remove} disabled={Boolean(busy)}>
            <NavIcon name="trash" size={16} />{busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
          <button type="button" className="es-btn es-btn--primary es-cartitem__go" onClick={checkout} disabled={Boolean(busy) || expired}>
            {busy === 'checkout' ? 'Opening checkout…' : item.totalCents === 0 ? 'Get tickets' : 'Checkout'}<NavIcon name="arrow" size={18} />
          </button>
        </div>
      </div>
    </li>
  );
}

/** "Held 34:12" — amber under five minutes, red under one; read out once a minute. */
function HoldTimer({ left }) {
  if (left === null) return null;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const tone = left < 60_000 ? 'danger' : left < 5 * 60_000 ? 'warning' : 'calm';
  const text = left === 0 ? 'Hold ended' : `${mins}:${String(secs).padStart(2, '0')}`;
  return (
    <span className="es-holdtimer" data-tone={tone} title="How long these tickets stay held for you">
      <NavIcon name="clock" size={14} />
      <span className="es-nums" aria-hidden="true">{text}</span>
      <span className="sr-only">{left === 0 ? 'The hold has ended' : `Held for ${mins} more ${mins === 1 ? 'minute' : 'minutes'}`}</span>
    </span>
  );
}

/** The clock, once a second, for the timers — read in an effect, never during render. */
function useNowSecond() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  return now;
}
