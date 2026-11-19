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
export function usePayOptions(reservationId, headers, enabled, refreshKey) {
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
    // refreshKey: the quote's total. A promo code or an add-on changes it, and
    // the offline amounts must follow (2026-11-17).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reservationId, enabled, headers?.['x-access-token'], refreshKey]);
  return options;
}

/**
 * Two choice cards, not a checkbox list (owner, 2026-11-19: "design is very
 * terrible"). They used to borrow the agreements' styling, where the icon was
 * a block of its own above a run-on sentence. Now each is one tappable card:
 * an icon tile, a short title with its amount opposite (the two totals can
 * differ, since paying the organizer carries no card fee), and one line on
 * what happens next. The radio stays a real radio: arrow keys and screen
 * readers work as they did.
 */
export default function PayOptions({ options, mode, onMode, methodId, onMethod, timezone, cardTotalCents, currency }) {
  if (!options?.available) return null;
  const both = options.card !== false;
  const choices = [
    both && {
      key: 'card',
      icon: 'card',
      title: 'Pay by card now',
      amount: cardTotalCents,
      currency: currency || options.currency,
      note: 'Your tickets are emailed straight away.',
    },
    {
      key: 'offline',
      icon: 'cash',
      title: 'Pay the organizer directly',
      amount: options.totalCents,
      currency: options.currency,
      note: `Pay by ${formatEventTime(options.dueAt, timezone)}. Your tickets are held and issued once the organizer confirms the payment.`,
    },
  ].filter(Boolean);

  return (
    <fieldset className="es-paychoice">
      <legend className="es-co__h2">How will you pay?</legend>
      <div className="es-paychoice__options">
        {choices.map((c) => (
          <label key={c.key} className={`es-paychoice__opt ${mode === c.key ? 'is-on' : ''}`}>
            <input type="radio" name="paymode" className="es-paychoice__radio" checked={mode === c.key} onChange={() => onMode(c.key)} />
            <span aria-hidden className="es-paychoice__icon"><NavIcon name={c.icon} size={22} /></span>
            <span className="es-paychoice__body">
              <span className="es-paychoice__head">
                <b>{c.title}</b>
                {Number.isFinite(Number(c.amount)) && c.amount !== null && (
                  <span className="es-paychoice__amount es-nums">{formatMoney(c.amount, c.currency)}</span>
                )}
              </span>
              <span className="es-paychoice__note">{c.note}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === 'offline' && (
        <label className="es-paychoice__method">
          <span>Payment method</span>
          <select className="es-input" required value={methodId || ''} onChange={(e) => onMethod(e.target.value)}>
            <option value="" disabled>Choose how you will pay</option>
            {options.methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <small>You will get the organizer&rsquo;s payment details and a reference on the next page and by email.</small>
        </label>
      )}
    </fieldset>
  );
}
