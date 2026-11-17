'use client';

import { useEffect, useState } from 'react';
import { get } from '../../utils/apiClient';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO PAY, when there is a choice (phase 2).
 *
 * `GET /public/reservations/:id/offline-options` says whether card is possible
 * for this event (the same rule the event page uses) and whether the buyer can
 * instead reserve and pay the organizer directly — with which methods, by
 * when, and for how much (no card fee: the offline total can be lower).
 *
 * With offline checkout switched off — the default — the answer is
 * `{ card: true, available: false }` and this renders nothing: the page is the
 * card checkout it always was.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function usePayOptions(reservationId, headers, enabled) {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/public/reservations/${reservationId}/offline-options`, {
          cache: 'no-store', noRedirect: true, headers,
        });
        if (!cancelled) setOptions(data);
      } catch {
        // Unknown means "card only", exactly the page before phase 2.
        if (!cancelled) setOptions({ card: true, available: false });
      }
    })();
    return () => { cancelled = true; };
    // headers is a fresh object each render; the token inside it is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId, enabled, headers?.['x-access-token']]);
  return options;
}

export default function PayOptions({ options, mode, onMode, methodId, onMethod, timezone }) {
  if (!options?.available) return null;
  const both = options.card !== false;

  return (
    <fieldset className="es-co__agree">
      <legend className="es-co__h2">How will you pay?</legend>
      {both && (
        <label>
          <input type="radio" name="paymode" checked={mode === 'card'} onChange={() => onMode('card')} />
          <span><NavIcon name="card" size={16} /> Card, now — tickets are emailed straight away.</span>
        </label>
      )}
      <label>
        <input type="radio" name="paymode" checked={mode === 'offline'} onChange={() => onMode('offline')} />
        <span>
          <NavIcon name="cash" size={16} /> Pay the organizer directly — {formatMoney(options.totalCents, options.currency)}, by{' '}
          {formatEventTime(options.dueAt, timezone)}. Your tickets are held and issued once they confirm the payment.
        </span>
      </label>

      {mode === 'offline' && (
        <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
          Payment method
          <select className="es-input" required value={methodId || ''} onChange={(e) => onMethod(e.target.value)}>
            <option value="" disabled>Choose how you will pay</option>
            {options.methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <span className="text-xs text-subtle">You will get the organizer&rsquo;s payment details and a reference on the next page and by email.</span>
        </label>
      )}
    </fieldset>
  );
}
