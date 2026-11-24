'use client';

import { useEffect, useId, useState } from 'react';
import { get } from '../../utils/apiClient';
import { formatMoney } from '../../utils/money';
import { parseMoneyToCents, moneyPlaceholder } from '../../lib/moneyInput';
import { currencySymbol } from '../../lib/markets';
import { commissionRate } from '../../lib/fees';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT EVENTSLI CHARGES — shown BEFORE the event is created (owner,
 * 2026-11-24: "show the organizer the exact commission before event
 * creation").
 *
 * The rate a new event in this country gets ("1.5% + $0.50 per ticket"), what
 * it comes to on a few ticket prices, and a box to try the organizer's own
 * price. Every amount is the API's (GET /organizer/fee-terms → the backend
 * fees file, the same function that charges every sale), so the figure here
 * is the figure charged. Nothing is worked out in the browser.
 *
 * The card processing fee is not part of this: it depends on who bears it
 * (chosen just above) and on the organizer's own Stripe pricing, and the
 * publish preview prices it per ticket type.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CommissionPreview({ country, compact = false }) {
  const ids = useId();
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState(null);
  const [price, setPrice] = useState('');
  const currency = terms?.currency || null;
  const tryCents = currency ? parseMoneyToCents(price, currency) : null;

  // One request per country and tried price, debounced while typing. The last
  // answer stays on screen until the next one lands, so nothing flickers.
  useEffect(() => {
    if (!country) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ country, ...(tryCents > 0 ? { prices: String(tryCents) } : {}) });
        const data = await get(`/organizer/fee-terms?${q}`, { cache: 'no-store', noRedirect: true });
        if (cancelled) return;
        // Only a whole answer is drawn: this sits on the event-creation pages,
        // and a malformed one must never take the page down with it.
        if (data && data.currency && Array.isArray(data.examples)) { setTerms(data); setError(null); } else setError(new Error('fee terms'));
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }, tryCents > 0 ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [country, tryCents]);

  if (error && !terms) return null;
  if (!terms) {
    return <div className="es-fees es-fees--loading" aria-busy="true"><span className="es-fees__shimmer" /></div>;
  }

  const rate = commissionRate(terms, currency);
  const tried = tryCents > 0 ? terms.examples.find((e) => e.priceCents === tryCents) : null;
  const rows = terms.examples.filter((e) => e.priceCents !== tryCents).slice(0, compact ? 3 : 4);

  return (
    <section className="es-fees" aria-labelledby={`${ids}-title`}>
      <div className="es-fees__head">
        <span className="es-fees__icon" aria-hidden="true"><NavIcon name="percent" size={20} /></span>
        <div className="fx-min0">
          <h3 id={`${ids}-title`} className="es-fees__title">What Eventsli charges</h3>
          <p className="es-fees__sub">Taken from your ticket sales — never added to the buyer’s price.</p>
        </div>
      </div>

      <div className="es-fees__rate">
        <span className="es-fees__rate-label">Commission</span>
        <b className="es-fees__rate-value es-nums">{rate}</b>
        {terms.commissionTaxPct > 0 && (
          <span className="es-fees__rate-tax">+ {terms.commissionTaxPct}% tax on the commission</span>
        )}
      </div>

      <ul className="es-fees__facts">
        <li><NavIcon name="check" size={16} /> Free tickets: no commission at all.</li>
        {terms.perTicket && <li><NavIcon name="check" size={16} /> The fixed part is per paid ticket, and never more than the ticket itself.</li>}
        <li><NavIcon name="check" size={16} /> Locked in when you create the event.</li>
      </ul>

      <div className="es-fees__try">
        <label htmlFor={`${ids}-price`} className="es-fees__try-label">Try your ticket price</label>
        <div className="es-fees__try-row">
          <span className="es-fees__try-input">
            <span aria-hidden="true">{currencySymbol(currency)}</span>
            <input
              id={`${ids}-price`} inputMode="decimal" autoComplete="off" placeholder={moneyPlaceholder(currency)}
              value={price} onChange={(e) => setPrice(e.target.value)}
              aria-describedby={`${ids}-tried`}
            />
          </span>
          <p id={`${ids}-tried`} className="es-fees__tried" aria-live="polite">
            {tried ? (
              <>
                Commission <b className="es-nums">{formatMoney(tried.commissionCents + tried.commissionTaxCents, currency)}</b>
                <span aria-hidden="true"> · </span>
                you keep <b className="es-nums es-fees__keep">{formatMoney(tried.youKeepCents, currency)}</b>
              </>
            ) : price && tryCents === null ? 'Enter a price like ' + moneyPlaceholder(currency) : 'Type a price to see the exact commission.'}
          </p>
        </div>
      </div>

      <table className="es-fees__table">
        <caption className="sr-only">Commission on one ticket at each price</caption>
        <thead>
          <tr><th scope="col">Ticket</th><th scope="col">Commission</th><th scope="col">You keep</th></tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.priceCents}>
              <th scope="row" className="es-nums">{formatMoney(e.priceCents, currency)}</th>
              <td className="es-nums">{formatMoney(e.commissionCents + e.commissionTaxCents, currency)}</td>
              <td className="es-nums es-fees__keep">{formatMoney(e.youKeepCents, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="es-fees__note">
        Before card processing, which depends on who pays the booking fees and on your Stripe account. Every ticket type is priced in full before you publish.
      </p>
    </section>
  );
}
