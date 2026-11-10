'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import NavIcon from '../shell/NavIcon';
import TierDetailIcon from './TierDetailIcon';
import { formatMoney } from '../../utils/money';
import { useModal } from '../../hooks/useModal';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ticket type's details card, opened before buying (owner request and mockup,
 * 2026-11-10: "VIP Table Experience").
 *
 * Photo and name across the top; what is included on the left; the price and
 * the organizer's notes on the right; how many and "Add to cart" along the
 * bottom. On a phone it is a sheet: the columns stack and the buying bar stays
 * pinned to the bottom of it.
 *
 * NOTHING HERE DECIDES WHAT IS BOUGHT. `max` is the most the caller will
 * accept, and `onAdd(quantity)` hands the number back: the seat page turns it
 * into seats, the ticket picker into a quantity. Every limit is enforced again
 * by the hold. The total on the button is the ticket price times the quantity,
 * labelled as such; fees and tax are the checkout's.
 *
 * `preview` is the organizer's view of the same card: the buying bar is shown
 * but does nothing, so what they see is exactly what a buyer will.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const UNIT_LABEL = { person: 'Price per person', table: 'Price per table', group: 'Price per group', ticket: 'Price per ticket' };
const KIND_BADGE = { vip: ['crown', 'VIP'], early_bird: ['clock', 'Early bird'], complimentary: ['star', 'Guest list'] };

export default function TierDetailsDialog({
  tier, currency, onClose, onAdd,
  max = 10, initialQuantity = 1, priceRange = null, unavailable = null, addLabel = 'Add to cart',
  footnote = null, preview = false, showQuantity = true,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [qty, setQty] = useState(() => Math.max(1, Math.min(initialQuantity, Math.max(max, 1))));
  useEffect(() => { closeRef.current?.focus(); }, []);
  useModal(dialogRef, onClose);

  const d = tier.details || {};
  const included = d.included || [];
  const notes = d.notes || [];
  // On the seat page the price is what the seats cost (a seat may carry its
  // own price), so a single-valued range wins over the type's price.
  const rangeKnown = Boolean(priceRange && Number.isFinite(priceRange.min));
  const ranged = rangeKnown && priceRange.min !== priceRange.max;
  const price = rangeKnown && !ranged ? Number(priceRange.min) : Number(tier.priceCents ?? 0);
  const free = !ranged && price === 0;
  const badge = KIND_BADGE[tier.kind] || null;
  const canBuy = !unavailable && max > 0;
  const total = free ? 'Free' : ranged ? null : formatMoney(price * qty, currency);
  const titleId = `tdx-title-${tier.id}`;

  // Portalled to <body>: it opens from inside a form panel and the seat map's
  // column, and a transformed ancestor would trap a `position: fixed` scrim.
  // It only ever renders after a click, so `document` exists.
  return createPortal(
    <div className="es-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="es-tdx">
        <header className={`es-tdx__hero ${d.image?.url ? 'has-photo' : ''}`}>
          {d.image?.url && (
            // A plain <img>: the URL is the organizer's storage object, already
            // sized at upload, and next/image would need its host configured.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.image.url} alt="" className="es-tdx__photo" />
          )}
          <button ref={closeRef} type="button" className="es-tdx__close" onClick={onClose} aria-label="Close">
            <NavIcon name="close" size={20} />
          </button>
          <div className="es-tdx__heading">
            <span className="es-tdx__badge" aria-hidden={!badge}>
              <NavIcon name={badge ? badge[0] : 'ticket'} size={20} />
              {badge && <span className="sr-only">{badge[1]}</span>}
            </span>
            <h2 id={titleId} className="es-tdx__title">{tier.name}</h2>
            {(d.tagline || (!included.length && tier.description)) && (
              <p className="es-tdx__tagline">{d.tagline || tier.description}</p>
            )}
          </div>
        </header>

        <div className="es-tdx__body">
          {(included.length > 0 || (d.tagline && tier.description)) && (
            <section className="es-tdx__included" aria-labelledby={`${titleId}-inc`}>
              <h3 id={`${titleId}-inc`} className="es-tdx__h">{included.length ? 'What’s included' : 'About this ticket'}</h3>
              {included.length > 0 ? (
                <ul className="es-tdx__list">
                  {included.map((item, i) => (
                    <li key={`${item.title}-${i}`}>
                      <span className="es-tdx__tile"><TierDetailIcon name={item.icon} size={26} /></span>
                      <span className="fx-min0">
                        <b>{item.title}</b>
                        {item.text && <small>{item.text}</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="es-tdx__about">{tier.description}</p>
              )}
            </section>
          )}

          <div className="es-tdx__aside">
            <div className="es-tdx__price">
              <span className="es-tdx__price-label">{UNIT_LABEL[d.priceUnit] || UNIT_LABEL.ticket}</span>
              <span className="es-tdx__price-value es-nums">
                {free ? 'Free' : ranged
                  ? `${formatMoney(priceRange.min, currency)} – ${formatMoney(priceRange.max, currency)}`
                  : formatMoney(price, currency)}
              </span>
              <NavIcon name="ticket" size={64} className="es-tdx__price-art" />
            </div>

            {(notes.length > 0 || unavailable) && (
              <ul className="es-tdx__notes">
                {unavailable && (
                  <li className="is-warn"><TierDetailIcon name="info" size={24} /><span>{unavailable}</span></li>
                )}
                {notes.map((n, i) => (
                  <li key={`${n.text}-${i}`}><TierDetailIcon name={n.icon} size={24} /><span>{n.text}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="es-tdx__buy">
          {canBuy && showQuantity && (
            <div className="es-tdx__qty">
              <span className="es-tdx__qty-label" id={`${titleId}-qty`}>Number of tickets</span>
              <div className="es-tdx__stepper" role="group" aria-labelledby={`${titleId}-qty`}>
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="One fewer">
                  <span aria-hidden="true">−</span>
                </button>
                <output className="es-nums" aria-live="polite">{qty}</output>
                <button
                  type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max}
                  aria-label="One more" title={qty >= max ? `Up to ${max} here` : undefined}
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            className="es-tdx__add"
            disabled={!canBuy || preview}
            onClick={() => onAdd?.(qty)}
            title={preview ? 'Preview — this is what a buyer sees' : undefined}
          >
            <NavIcon name="cart" size={22} />
            <span>{canBuy ? (total && showQuantity ? `${addLabel} — ${total}` : addLabel) : 'Not available'}</span>
            <NavIcon name="chevronRight" size={20} />
          </button>
          {footnote && <p className="es-tdx__foot">{footnote}</p>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Does this ticket type have a card worth a "Details" button? */
export function hasDetails(tier) {
  const d = tier?.details;
  return Boolean(d && (d.tagline || d.image || d.included?.length || d.notes?.length));
}
