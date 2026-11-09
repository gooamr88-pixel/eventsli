'use client';

import NavIcon from '../../../components/shell/NavIcon';
import { formatMoney } from '../../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The seat page's two side columns on a wide screen.
 *
 * LEFT, the ticket categories: what each kind of seat costs and how many are
 * left, with a checkbox that picks those seats out on the map (2D, 3D and
 * 360° alike). Checking none shows everything. It never restricts: a dimmed
 * seat can still be chosen.
 *
 * RIGHT, the basket: every chosen seat named and priced, the running sum, and
 * the way on. The sum is labelled as the sum of seat prices; the real total,
 * with tax and fees, comes from the server's quote after the hold.
 *
 * On a phone neither column exists: the categories fold to chips above the
 * map and the basket is the sticky SelectionBar, as before.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function priceLabel(tier, currency) {
  if (tier.min === Infinity) return 'At checkout';
  if (tier.max === 0) return 'Free';
  if (tier.min === tier.max) return formatMoney(tier.max, currency);
  return `${formatMoney(tier.min, currency)}–${formatMoney(tier.max, currency)}`;
}

export function TicketCategories({ tiers, palette, currency, picked, onToggle, showTaken, onShowTaken }) {
  return (
    <section className="es-sidecard es-catcard" aria-labelledby="cat-title">
      <h2 id="cat-title" className="es-sidecard__title">Ticket categories</h2>
      <ul className="es-catlist">
        {tiers.map((t) => {
          const on = picked.has(t.id);
          return (
            <li key={t.id}>
              <label className={`es-catlist__row ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(t.id)} className="es-catlist__check" />
                <span className="es-swatch es-swatch--lg" style={{ background: palette.get(t.id) }} aria-hidden="true" />
                <span className="fx-min0">
                  <b>{t.name}</b>
                  <small>{t.free === 0 ? 'Sold out' : `${t.free.toLocaleString('en')} left`}</small>
                </span>
                <span className="es-nums es-catlist__price">{priceLabel(t, currency)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-subtle">Tick categories to pick their seats out on the map.</p>
      <label className="es-catlist__toggle">
        <span>Show unavailable seats</span>
        <input type="checkbox" role="switch" className="es-studio-switch" checked={showTaken} onChange={(e) => onShowTaken(e.target.checked)} />
      </label>
    </section>
  );
}

export function Basket({
  seats, tableLabel, nameFor, tierOf, currency, subtotal, count, busy, onRemove, onClear, onContinue, error,
}) {
  const empty = count === 0;
  return (
    <section className="es-sidecard es-basket" aria-labelledby="basket-title">
      <div className="fx-row fx-row--between">
        <h2 id="basket-title" className="es-sidecard__title">Your selection {count > 0 && <span className="es-nums">({count})</span>}</h2>
        {!empty && (
          <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={onClear} disabled={busy} aria-label="Clear the selection">
            <NavIcon name="trash" size={16} />
          </button>
        )}
      </div>

      {empty ? (
        <div className="es-basket__empty">
          <NavIcon name="pointer" size={22} />
          <p>Tap seats on the map, or open 3D and pick a seat to see its view.</p>
        </div>
      ) : (
        <ul className="es-basket__list">
          {tableLabel && (
            <li className="es-basket__row">
              <span className="fx-min0"><b>Table {tableLabel}</b><small>The whole table</small></span>
              <span className="es-nums">{subtotal === null ? '' : formatMoney(subtotal, currency)}</span>
            </li>
          )}
          {seats.map((seat) => {
            const tier = tierOf(seat);
            // 'Section Gold · Row C · Seat 11' reads as two lines: where in the
            // section on top, the category and section beneath.
            const full = nameFor(seat);
            const parts = full.split(' · ');
            const sectioned = parts[0].startsWith('Section ') && parts.length > 1;
            const title = sectioned ? parts.slice(1).join(' · ') : full;
            const sub = sectioned ? [tier?.name, parts[0]].filter(Boolean).join(' · ') : tier?.name;
            return (
              <li key={seat.id} className="es-basket__row">
                <span className="es-swatch" style={{ background: tier?.color }} aria-hidden="true" />
                <span className="fx-min0">
                  <b>{title}</b>
                  {sub && <small>{sub}</small>}
                </span>
                <span className="es-nums">
                  {seat.priceCents === null || seat.priceCents === undefined ? '' : seat.priceCents === 0 ? 'Free' : formatMoney(seat.priceCents, currency)}
                </span>
                <button type="button" className="es-basket__x" onClick={() => onRemove(seat)} disabled={busy} aria-label={`Remove ${nameFor(seat)}`}>
                  <NavIcon name="close" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="es-basket__sum">
        <div><dt>Tickets ({count})</dt><dd className="es-nums">{subtotal === null ? '—' : formatMoney(subtotal, currency)}</dd></div>
        <div className="es-basket__fees"><dt>Fees and tax</dt><dd>At checkout</dd></div>
      </dl>

      {error}

      <button type="button" className="es-btn es-btn--primary es-basket__go" disabled={empty || busy} onClick={onContinue}>
        {busy ? 'Holding your seats…' : 'Proceed to checkout'}<NavIcon name="arrow" size={18} />
      </button>

      <ul className="es-trust">
        <li><NavIcon name="clock" size={18} />Your seats are held for you while you pay</li>
        <li><NavIcon name="qr" size={18} />Instant e-ticket with a QR code</li>
        <li><NavIcon name="shield" size={18} />Secure card payment</li>
      </ul>
    </section>
  );
}

/** Phones and tablets: the categories as chips, the same toggles as the card. */
export function CategoryChips({ tiers, palette, currency, picked, onToggle }) {
  return (
    <ul className="es-seatpage__chips fx-row fx-row--gap" aria-label="Seat prices">
      {tiers.map((tier) => {
        const on = picked.has(tier.id);
        return (
          <li key={tier.id}>
            <button
              type="button"
              onClick={() => onToggle(tier.id)}
              aria-pressed={on}
              className={`es-pill fx-row gap-2 ${on ? 'es-pill--accent' : ''}`}
            >
              <span className="es-swatch" style={{ background: palette.get(tier.id) }} aria-hidden="true" />
              <span className="text-ink">{tier.name}</span>
              <span className="es-nums">{priceLabel(tier, currency)}</span>
              {tier.free === 0 && <span className="text-subtle">· sold out</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
