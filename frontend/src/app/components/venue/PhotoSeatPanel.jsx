'use client';

import { useMemo, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Seats in this view": the seats a 360° photo looks out over, laid over the
 * photo so they can be chosen without leaving it.
 *
 * A photo knows which rows it covers (`view.tables`, set in Venue Studio) but
 * not where each seat sits in the image, so the seats are offered as buttons by
 * row rather than as spots on the picture. Each button does exactly what the
 * seat card's main action does — `actionFor` is passed in — so the per-order
 * limit, table-only events and the organizer's block/release all behave as
 * they do on the 2D map.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PhotoSeatPanel({
  view, model, index, selectedSeatIds, focusTiers, activeId, actionFor, describe, onFocus,
}) {
  const [open, setOpen] = useState(true);

  const rows = useMemo(() => {
    if (!model || !view) return [];
    const byLabel = new Map();
    for (const entry of model.seats) {
      if (!view.tables.includes(entry.tableLabel)) continue;
      if (!byLabel.has(entry.tableLabel)) byLabel.set(entry.tableLabel, []);
      byLabel.get(entry.tableLabel).push(entry);
    }
    // In the order the organizer listed the rows on the photo.
    return view.tables
      .filter((label) => byLabel.has(label))
      .map((label) => {
        const where = index.get(label);
        const seats = byLabel.get(label).sort((a, b) => Number(a.number) - Number(b.number));
        return { label, name: where ? `${where.section} · Row ${where.row}` : `Table ${label}`, seats };
      });
  }, [model, view, index]);

  if (!rows.length) return null;

  const openCount = rows.reduce((n, r) => n + r.seats.filter((e) => e.seat?.available).length, 0);

  return (
    <section className="es-photoseats" aria-label="Seats in this view">
      <button
        type="button"
        className="es-photoseats__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold">Seats in this view</span>
        <span className="es-nums text-xs opacity-80">{openCount} open</span>
        <svg className="es-photoseats__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="es-photoseats__body">
          {rows.map((row) => (
            <div key={row.label} className="es-photoseats__row">
              <p className="es-photoseats__rowname">{row.name}</p>
              <ul className="es-photoseats__seats" aria-label={row.name}>
                {row.seats.map((entry) => {
                  const s = entry.seat;
                  const chosen = Boolean(s && selectedSeatIds.has(s.id));
                  const action = actionFor(entry);
                  // How it looks and whether it can be pressed are separate: the
                  // organizer's view releases unavailable seats from here.
                  const taken = !chosen && (!s || !s.available);
                  const blocked = action.disabled || !action.onPress;
                  const dim = !chosen && !taken && focusTiers && !focusTiers.has(s.tierId);
                  const info = describe(entry);
                  const state = chosen ? 'chosen' : taken ? 'taken' : 'open';
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`es-photoseats__seat es-photoseats__seat--${state} ${dim ? 'is-dim' : ''} ${entry.id === activeId ? 'is-active' : ''}`}
                        style={state === 'open' && info.color ? { '--seat-tier': info.color } : undefined}
                        disabled={blocked}
                        aria-pressed={chosen}
                        aria-label={`${info.name}${info.price ? `, ${info.price}` : ''}${taken ? ', unavailable' : ''}`}
                        title={`${info.name}${info.price ? ` · ${info.price}` : ''}`}
                        onClick={() => { onFocus(entry); action.onPress?.(); }}
                      >
                        {entry.number}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
