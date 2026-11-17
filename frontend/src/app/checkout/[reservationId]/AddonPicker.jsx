'use client';

import { useState } from 'react';
import { put } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "MAKE IT SPECIAL" — the event's add-ons (owner, 2026-11-17): a photo with the
 * headliner, a meet & greet. Chosen here, at checkout, before paying.
 *
 *   · up to ONE per ticket on the order — four tickets, at most four photos —
 *     and never past what the organizer has left;
 *   · priced on top of the tickets, under the same fees, and shown as their
 *     own lines in the total beside this;
 *   · delivered by the ORGANIZER, who alone is responsible for them. Said
 *     here, before anyone pays for one.
 *
 * Every tap sends the WHOLE choice to the server, which checks the limits
 * under a lock and answers with the new total; the page then reloads its
 * quote. Nothing is counted here — the numbers on screen are the server's.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AddonPicker({ reservationId, headers, quote, organizerName, disabled, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const offered = Array.isArray(quote.addonsOffered) ? quote.addonsOffered : [];
  const chosen = new Map((quote.addons || []).map((a) => [a.addonId, a.quantity]));
  // An add-on taken off sale after the buyer chose it stays listed, so it can
  // still be removed.
  const gone = (quote.addons || []).filter((a) => !offered.some((o) => o.id === a.addonId));
  if (offered.length === 0 && gone.length === 0) return null;

  const admits = Number(quote.admits) || 0;

  async function setQuantity(addonId, quantity) {
    setBusy(addonId);
    setError(null);
    const next = new Map(chosen);
    if (quantity > 0) next.set(addonId, quantity); else next.delete(addonId);
    try {
      await put(
        `/public/reservations/${reservationId}/addons`,
        { lines: [...next].map(([id, q]) => ({ addonId: id, quantity: q })) },
        { headers, noRedirect: true },
      );
      await onChanged();
    } catch (err) {
      setError(err);
      // Someone else may have taken the last one: the fresh quote shows what is left.
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  const rows = [
    ...offered.map((a) => ({ ...a, mine: chosen.get(a.id) || 0 })),
    ...gone.map((a) => ({ id: a.addonId, name: a.name, priceCents: a.unitPriceCents, description: null, remaining: 0, mine: a.quantity, off: true })),
  ];

  return (
    <section className="es-co__card es-addons" aria-labelledby="co-addons">
      <h2 id="co-addons" className="es-co__h2 es-co__h2--icon">
        <NavIcon name="star" size={20} />
        Make it special
      </h2>
      <p className="es-co__sub">
        Optional extras for this event — up to one per ticket ({admits} on this order).
      </p>

      <ul className="es-addons__list">
        {rows.map((a) => {
          // What this order may take: one per ticket, and no more than the
          // organizer has left. `remaining` already counts this order's own.
          const ceiling = a.off ? a.mine : Math.min(admits, a.remaining === null ? admits : a.remaining + a.mine);
          const soldOut = !a.off && a.remaining === 0 && a.mine === 0;
          const working = busy === a.id;
          return (
            <li key={a.id} className={`es-addons__item ${a.mine > 0 ? 'is-on' : ''}`}>
              <div className="fx-min0">
                <p className="es-addons__name fx-break">{a.name}</p>
                {a.description && <p className="es-addons__desc fx-break">{a.description}</p>}
                <p className="es-addons__price es-nums">
                  {a.priceCents === 0 ? 'Free' : formatMoney(a.priceCents, quote.currency)}
                  <span> each</span>
                  {a.off && <em> · no longer offered</em>}
                  {!a.off && a.remaining !== null && a.remaining > 0 && a.remaining <= 10 && <em> · only {a.remaining} left</em>}
                </p>
              </div>
              {soldOut ? (
                <span className="es-pill shrink-0">Sold out</span>
              ) : (
                <div className="es-addons__step" role="group" aria-label={`${a.name} quantity`}>
                  <button
                    type="button"
                    onClick={() => setQuantity(a.id, a.mine - 1)}
                    disabled={disabled || Boolean(busy) || a.mine === 0}
                    aria-label={`One fewer ${a.name}`}
                  >
                    −
                  </button>
                  <span className="es-nums" aria-live="polite">{working ? '…' : a.mine}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(a.id, a.mine + 1)}
                    disabled={disabled || Boolean(busy) || a.off || a.mine >= ceiling}
                    aria-label={`One more ${a.name}`}
                    title={a.mine >= ceiling && !a.off ? (a.mine >= admits ? 'One per ticket on this order' : 'No more left') : undefined}
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {describeError(error).title}. {describeError(error).recovery}
        </p>
      )}

      <p className="es-addons__note">
        <NavIcon name="info" size={16} />
        <span>
          Add-ons are provided at the event by {organizerName || 'the organizer'}, who alone is responsible for
          delivering them. Eventsli only takes the payment. Questions about an add-on go to the organizer.
        </span>
      </p>
    </section>
  );
}
