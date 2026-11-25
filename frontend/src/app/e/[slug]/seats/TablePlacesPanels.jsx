'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import PaymentBadges from '../../../components/PaymentBadges';
import { formatMoney } from '../../../utils/money';
import Stepper from '../tickets/Stepper';

/**
 * The places-at-a-table page's own panels (2026-11-25): how many guests, the
 * tables chosen for them, and the phone's sticky bar. Seat words never appear
 * here — the buyer books places at a table, and that is all they are told.
 */

const places = (n) => `${n} ${n === 1 ? 'place' : 'places'}`;
const price = (cents, currency) => (cents === null || cents === undefined ? '' : cents === 0 ? 'Free' : formatMoney(cents, currency));
// "VIP 3" and "Table 4" read as names already; a bare "4" needs the word.
export const tableName = (label) => (!label ? 'a table'
  : /table|^vip|[a-z]{3,}/i.test(label) ? label : `Table ${label}`);

/** "How many guests?" — the first thing a host asks. */
export function GuestsCard({ guests, max, waiting, onChange, compact = false }) {
  return (
    <section className={`es-sidecard es-guests ${compact ? 'es-guests--compact' : ''}`} aria-labelledby="guests-title">
      <div className="es-guests__row">
        <span className="fx-min0">
          <h2 id="guests-title" className="es-sidecard__title">How many guests?</h2>
          <small className="text-subtle">Up to {max} in one booking</small>
        </span>
        <Stepper
          value={guests} name="guest"
          onMinus={() => onChange(guests - 1)} onPlus={() => onChange(guests + 1)}
          minusDisabled={guests <= 1} plusDisabled={guests >= max}
          plusTitle={guests >= max ? `At most ${max} in one booking` : undefined}
        />
      </div>
      <p className="es-guests__hint" role="status">
        {waiting > 0
          ? <><NavIcon name="pointer" size={16} />Tap a table on the map for {waiting === guests ? 'your party' : `the other ${waiting}`}.</>
          : <><NavIcon name="check" size={16} />Everyone has a place. Tap another table to move your party there.</>}
      </p>
    </section>
  );
}

/** The tables chosen, what they cost, and the way on. */
export function PlacesBasket({
  rows, currency, guests, subtotal, busy, onRemove, onClear, onContinue, onAddToCart, inCart, cartCount,
  error, payments, extrasCount = 0, extrasCents = 0,
}) {
  const count = rows.reduce((n, r) => n + r.quantity, 0);
  const empty = count === 0;
  return (
    <section className="es-sidecard es-basket" aria-labelledby="basket-title">
      <div className="fx-row fx-row--between">
        <h2 id="basket-title" className="es-sidecard__title">Your table{rows.length > 1 ? 's' : ''} {count > 0 && <span className="es-nums">({places(count)})</span>}</h2>
        {!empty && (
          <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={onClear} disabled={busy} aria-label="Clear the selection">
            <NavIcon name="trash" size={16} />
          </button>
        )}
      </div>

      {empty ? (
        <div className="es-basket__empty">
          <NavIcon name="users" size={22} />
          <p>Choose how many guests, then tap a table on the map. Your party sits together — no seat numbers.</p>
        </div>
      ) : (
        <ul className="es-basket__list">
          {rows.map((r) => (
            <li key={r.tableId} className="es-basket__row">
              <span className="es-swatch" style={{ background: r.color || undefined }} aria-hidden="true" />
              <span className="fx-min0">
                <b>{tableName(r.label)}</b>
                <small>{[places(r.quantity), r.tiers.join(', ')].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="es-nums">{price(r.priceCents, currency)}</span>
              <button type="button" className="es-basket__x" onClick={() => onRemove(r.tableId)} disabled={busy} aria-label={`Remove ${tableName(r.label)}`}>
                <NavIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!empty && count < guests && (
        <p className="es-guests__short">{guests - count} of your {guests} guests {guests - count === 1 ? 'has' : 'have'} no table yet. Tap another table, or continue with {places(count)}.</p>
      )}

      <dl className="es-basket__sum">
        <div><dt>Places ({count})</dt><dd className="es-nums">{subtotal === null ? '—' : subtotal === 0 ? 'Free' : formatMoney(subtotal, currency)}</dd></div>
        {extrasCount > 0 && (
          <div><dt>Extras ({extrasCount})</dt><dd className="es-nums">{extrasCents === 0 ? 'Free' : formatMoney(extrasCents, currency)}</dd></div>
        )}
        <div className="es-basket__fees"><dt>Fees and tax</dt><dd>At checkout</dd></div>
      </dl>

      {error}

      <button type="button" className="es-btn es-btn--primary es-basket__go" disabled={empty || busy} onClick={onContinue}>
        {busy ? 'Holding your places…' : 'Proceed to checkout'}<NavIcon name="arrow" size={18} />
      </button>
      {onAddToCart && (
        <button type="button" className="es-btn es-btn--secondary es-basket__go" disabled={empty || busy} onClick={onAddToCart}>
          <NavIcon name="cart" size={18} />{inCart ? 'Update cart' : 'Add to cart'}
        </button>
      )}
      {cartCount > 0 && (
        <Link href="/cart" className="es-basket__cartlink">
          <NavIcon name="cart" size={16} />View cart ({cartCount} {cartCount === 1 ? 'ticket' : 'tickets'})
        </Link>
      )}

      <div className="es-paysafe">
        <p><NavIcon name="shield" size={18} />Secure &amp; encrypted payment</p>
        <PaymentBadges payments={payments} />
      </div>
    </section>
  );
}

/** Phones and tablets: the party and the total, pinned to the bottom. */
export function PlacesBar({ rows, total, currency, busy, onContinue, onAddToCart, inCart, onClear }) {
  const count = rows.reduce((n, r) => n + r.quantity, 0);
  const where = rows.map((r) => tableName(r.label)).join(' + ');
  return (
    <div className="es-seatbar fx-safe-bottom sticky bottom-0 z-(--es-z-sticky)">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          {count > 0 ? (
            <>
              <p className="es-nums text-lg font-medium text-ink">
                {total === null ? 'Price at checkout' : total === 0 ? 'Free' : formatMoney(total, currency)}
              </p>
              <p className="fx-truncate text-sm text-muted">
                {where} · {places(count)}{total !== null && total > 0 && ' · before tax and fees'}
              </p>
            </>
          ) : (
            <p className="text-muted">Tap a table to choose it</p>
          )}
        </div>
        <div className="fx-row">
          {count > 0 && !onAddToCart && (
            <button type="button" onClick={onClear} className="es-btn es-btn--ghost es-btn--sm">Clear</button>
          )}
          {onAddToCart && (
            <button
              type="button" onClick={onAddToCart} disabled={count === 0 || busy}
              className="es-btn es-btn--secondary es-selbar__cart"
              aria-label={inCart ? 'Update cart' : 'Add to cart'} title={inCart ? 'Update cart' : 'Add to cart'}
            >
              <NavIcon name="cart" size={20} />
            </button>
          )}
          <button type="button" disabled={count === 0 || busy} onClick={onContinue} className="es-btn es-btn--primary">
            {busy ? 'Holding…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
