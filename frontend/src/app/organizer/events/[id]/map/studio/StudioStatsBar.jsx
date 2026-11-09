'use client';

import NavIcon from '../../../../../components/shell/NavIcon';
import { tierPalette } from '../../../../../components/venue/venueModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The room in figures, under the canvas: capacity, sections, rows and seats,
 * then how the seats split across ticket types.
 *
 * The split is the number an organizer prices by — "a quarter of the room is
 * VIP" — and it changes with every row drawn, so it sits where the drawing
 * happens rather than on a report page. Seats with no ticket type are counted
 * as their own share, because they are the ones that cannot be sold.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function StudioStatsBar({ tables, sections, tiers, standing = 0 }) {
  const seats = tables.reduce((n, t) => n + (Number(t.seatCount) || 0), 0);
  const rows = tables.filter((t) => t.shape === 'row').length;
  const palette = tierPalette(tiers, []);
  const byTier = new Map();
  for (const t of tables) byTier.set(t.tierId || '', (byTier.get(t.tierId || '') || 0) + (Number(t.seatCount) || 0));
  const shares = [
    ...tiers.filter((t) => byTier.get(t.id)).map((t) => ({ key: t.id, name: t.name, color: palette.get(t.id), n: byTier.get(t.id) })),
    ...(byTier.get('') ? [{ key: 'none', name: 'No ticket type', color: '#9aa8ad', n: byTier.get('') }] : []),
  ];
  const pct = (n) => (seats ? Math.round((n / seats) * 100) : 0);

  return (
    <div className="es-statsbar">
      <dl className="es-statsbar__figures">
        <div className="es-statsbar__lead">
          <span className="es-statsbar__icon" aria-hidden="true"><NavIcon name="building" size={22} /></span>
          <span><dt>Venue capacity</dt><dd className="es-nums">{(seats + standing).toLocaleString('en')}</dd></span>
        </div>
        <div><dt>Sections</dt><dd className="es-nums">{sections.length}</dd></div>
        <div><dt>Rows</dt><dd className="es-nums">{rows}</dd></div>
        <div><dt>Seats</dt><dd className="es-nums">{seats.toLocaleString('en')}</dd></div>
      </dl>
      {shares.length > 0 && (
        <ul className="es-statsbar__shares" aria-label="Seats by ticket type">
          {shares.map((s) => (
            <li key={s.key}>
              <span className="es-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="fx-min0">
                <b>{s.name}</b>
                <small className="es-nums">{s.n.toLocaleString('en')} ({pct(s.n)}%)</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shares.length > 1 && (
        <div className="es-statsbar__bar" aria-hidden="true">
          {shares.map((s) => <span key={s.key} style={{ width: `${pct(s.n)}%`, background: s.color }} />)}
        </div>
      )}
    </div>
  );
}
