'use client';

import { useId, useState } from 'react';
import { MARKET_ROWS, REGIONS } from '../../lib/markets';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The `currencies` setting, as a super admin edits it: which of the ~240
 * countries are OPEN to organizers, and in which of those card checkout is ON.
 *
 *   open   organizers there can sign up and create events, priced in the
 *          country's own currency (never chosen separately, BRD §07)
 *   card   only where Stripe offers accounts. Everywhere else that is open
 *          sells offline: the organizer's own methods, confirmed by hand.
 *
 * Card is its own switch because a Stripe country is not automatically one
 * this platform's Stripe account can onboard — CA and US are verified. Switch
 * another on once a test-mode account there has been created.
 *
 * The draft is `{ open: string[], card: string[] }`; Settings.jsx turns it
 * into the API's `{ allowed, by_country, card }`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function marketsDraft(base) {
  const open = Object.keys(base.by_country || {});
  const card = Array.isArray(base.card) ? base.card : ['CA', 'US'].filter((c) => open.includes(c));
  return { open, card };
}

export function marketsValue(draft) {
  const chosen = MARKET_ROWS.filter((m) => draft.open.includes(m.country));
  if (!chosen.length) return null;
  return {
    allowed: [...new Set(chosen.map((m) => m.currency))].sort(),
    by_country: Object.fromEntries(chosen.map((m) => [m.country, m.currency])),
    card: MARKET_ROWS.filter((m) => m.card && draft.open.includes(m.country) && draft.card.includes(m.country))
      .map((m) => m.country).sort(),
  };
}

export default function MarketSwitches({ draft, setDraft, canEdit }) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (m) => !q || m.name.toLowerCase().includes(q) || m.country.toLowerCase() === q || m.currency.toLowerCase() === q;

  const open = new Set(draft.open);
  const card = new Set(draft.card);
  const openCount = open.size;
  const cardCount = MARKET_ROWS.filter((m) => m.card && open.has(m.country) && card.has(m.country)).length;

  const setOpen = (codes, on) => setDraft((d) => {
    const next = new Set(d.open);
    for (const c of codes) (on ? next.add(c) : next.delete(c));
    // Closing a country also switches its card payments off.
    return { open: [...next], card: on ? d.card : d.card.filter((c) => !codes.includes(c)) };
  });
  const setCard = (code, on) => setDraft((d) => ({
    ...d, card: on ? [...new Set([...d.card, code])] : d.card.filter((c) => c !== code),
  }));

  return (
    <div className="fx-stack fx-stack--sm">
      <p className="text-sm text-ink" role="status">
        <b>{openCount}</b> of {MARKET_ROWS.length} countries open · card payments on in <b>{cardCount}</b>.
        {' '}Everywhere else that is open sells offline.
      </p>

      <div className="fx-row fx-row--gap items-end">
        <div className="fx-stack fx-min0 flex-1 gap-1.5">
          <label htmlFor={searchId} className="text-sm text-ink">Find a country</label>
          <input
            id={searchId} type="search" className="es-input" placeholder="Country, code or currency"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {canEdit && (
          <div className="fx-row fx-row--gap">
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setOpen(MARKET_ROWS.map((m) => m.country), true)}>
              Open every country
            </button>
          </div>
        )}
      </div>

      <div className="fx-stack fx-stack--sm max-h-[32rem] overflow-y-auto rounded-(--es-radius-md) border border-border-base p-2">
        {REGIONS.map((region) => {
          const rows = MARKET_ROWS.filter((m) => m.region === region && matches(m));
          if (!rows.length) return null;
          const regionOpen = rows.filter((m) => open.has(m.country)).length;
          return (
            <details key={region} open={Boolean(q)} className="rounded-(--es-radius-sm)">
              <summary className="fx-row fx-row--between cursor-pointer px-2 py-1.5 text-sm font-medium text-ink">
                <span>{region}</span>
                <span className="text-xs text-subtle">{regionOpen} of {rows.length} open</span>
              </summary>
              {canEdit && (
                <div className="fx-row fx-row--gap px-2 pb-1">
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setOpen(rows.map((m) => m.country), true)}>
                    Open all {rows.length}
                  </button>
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setOpen(rows.map((m) => m.country), false)}>
                    Close all
                  </button>
                </div>
              )}
              <ul className="fx-stack px-2 pb-2">
                {rows.map((m) => (
                  <li key={m.country} className="fx-row fx-row--between gap-2 border-t border-border-base py-1.5 text-sm first:border-0">
                    <label className="fx-row fx-min0 items-center gap-2 text-ink">
                      <input
                        type="checkbox" className="size-5 accent-[var(--es-accent)]" disabled={!canEdit}
                        checked={open.has(m.country)}
                        onChange={(e) => setOpen([m.country], e.target.checked)}
                      />
                      <span className="fx-truncate">{m.name}</span>
                      <span className="text-xs text-subtle">{m.currency}</span>
                    </label>
                    {m.card ? (
                      <label className="fx-row items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox" className="size-4 accent-[var(--es-accent)]"
                          disabled={!canEdit || !open.has(m.country)}
                          checked={open.has(m.country) && card.has(m.country)}
                          onChange={(e) => setCard(m.country, e.target.checked)}
                          aria-label={`Card payments in ${m.name}`}
                        />
                        Card
                      </label>
                    ) : (
                      <span className="text-xs text-subtle">Offline only</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="text-xs text-subtle">
        Card is offered only where Stripe operates. Switch it on for a country once a test Stripe account there has been
        created and onboarded; until then organizers there sell with their own payment methods.
      </p>
    </div>
  );
}
