'use client';

import { formatMoney } from '../../utils/money';

/**
 * The chosen seat, said in words: where it is, what it is, what it costs, and
 * the one thing to do next. Shared by the 3D view's pick card, the 360° view's
 * detail panel and the organizer's preview, so all three name a seat alike.
 */
export function priceText(seat, currency) {
  if (!seat || seat.priceCents === null || seat.priceCents === undefined || !currency) return null;
  return seat.priceCents === 0 ? 'Free' : formatMoney(seat.priceCents, currency);
}

export default function SeatCard({
  name, tier, color, price, status, action, secondary, onClose, compact = false, children,
}) {
  return (
    <div className={`es-seatcard ${compact ? 'es-seatcard--compact' : ''}`}>
      <div className="fx-row fx-row--between items-start gap-2">
        <div className="fx-min0 fx-stack gap-1">
          <p className="es-seatcard__name">{name}</p>
          <p className="fx-row gap-2 text-sm text-muted">
            {tier && (
              <span className="fx-row gap-1">
                <span className="es-swatch" style={{ background: color }} aria-hidden="true" />
                {tier}
              </span>
            )}
            {price && <span className="es-nums font-medium text-ink">{price}</span>}
            {status && <span className="text-subtle">{status}</span>}
          </p>
        </div>
        {onClose && (
          <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>
      {children}
      {(action || secondary) && (
        <div className="fx-row gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onPress}
              disabled={action.disabled}
              className={`es-btn es-btn--sm ${action.tone === 'secondary' ? 'es-btn--secondary' : 'es-btn--primary'}`}
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button type="button" onClick={secondary.onPress} className="es-btn es-btn--sm es-btn--ghost">
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The 360° view's strip: the seat's own view, the stage's, and every photo the
 * organizer uploaded. Generated views get a drawn tile; photos show themselves.
 */
export function ViewStrip({ items, active, onPick }) {
  return (
    <ul className="es-viewstrip" aria-label="Views">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            aria-pressed={active === it.id}
            onClick={() => onPick(it.id)}
            className="es-viewstrip__tile"
          >
            {it.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.url} alt="" loading="lazy" className="es-viewstrip__img" />
            ) : (
              <span className={`es-viewstrip__img es-viewstrip__img--${it.id}`} aria-hidden="true" />
            )}
            <span className="es-viewstrip__label">{it.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
