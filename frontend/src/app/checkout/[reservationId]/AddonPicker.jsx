'use client';

import { useState } from 'react';
import { put } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import ExtrasList from '../../e/[slug]/tickets/ExtrasList';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "MAKE IT SPECIAL" at checkout — the event's add-ons (owner, 2026-11-17): a
 * photo with the headliner, a meet & greet.
 *
 * Since 2026-11-22 a general-admission buyer chooses them beside the tickets,
 * before checkout, so this picker only shows on a SEATED order (the seat page
 * has no room for them). It draws with the same `ExtrasList` either way.
 *
 *   · up to ONE per ticket on the order, never past what the organizer has left;
 *   · priced on top of the tickets, under the same fees, as their own lines;
 *   · delivered by the ORGANIZER, who alone is responsible for them.
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
    ...offered.map((a) => {
      const mine = chosen.get(a.id) || 0;
      // `remaining` already counts this order's own.
      const ceiling = Math.min(admits, a.remaining === null ? admits : a.remaining + mine);
      return {
        ...a,
        mine,
        ceiling,
        soldOut: a.remaining === 0 && mine === 0,
        note: a.remaining !== null && a.remaining > 0 && a.remaining <= 10 ? `only ${a.remaining} left` : null,
      };
    }),
    ...gone.map((a) => ({
      id: a.addonId, name: a.name, priceCents: a.unitPriceCents, description: null,
      mine: a.quantity, ceiling: a.quantity, off: true, note: 'no longer offered',
    })),
  ];

  return (
    <div className="es-co__card es-co__card--extras">
      <ExtrasList
        rows={rows}
        currency={quote.currency}
        organizerName={organizerName}
        tickets={admits}
        disabled={disabled}
        busyId={busy}
        onSet={setQuantity}
        headingId="co-addons"
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {describeError(error).title}. {describeError(error).recovery}
        </p>
      )}
    </div>
  );
}
