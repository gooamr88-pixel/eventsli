'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import { newScheduleRow } from './aiDraftModel';

/**
 * The running order. Times are optional, as on the event's own schedule
 * editor: an organizer knows the order before they know the clock, and the AI
 * fills a time only where the description gave one. A room is left empty
 * unless the organizer named it.
 */
export default function EditSchedule({ form, set, errorFor }) {
  const rows = form.schedule;
  const update = (k, patch) => set({ schedule: rows.map((r) => (r.key === k ? { ...r, ...patch } : r)) });
  const move = (i, delta) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + delta, 0, row);
    set({ schedule: next });
  };

  return (
    <div className="fx-stack fx-stack--sm">
      {rows.length === 0 && <p className="text-sm text-muted">No running order yet. It is optional.</p>}
      <ol className="es-ai-schedlist" aria-label="Schedule">
        {rows.map((r, i) => {
          const error = errorFor(`row-${r.key}-title`);
          return (
            <li key={r.key} className="es-ai-schedrow">
              <label className="es-ai-field es-ai-field--wide">
                <span className="text-xs text-subtle">What</span>
                <input
                  className="es-input es-input--sm" value={r.title} maxLength={160} placeholder="e.g. Doors open"
                  aria-invalid={error ? 'true' : undefined} onChange={(e) => update(r.key, { title: e.target.value })}
                />
              </label>
              <label className="es-ai-field">
                <span className="text-xs text-subtle">When (optional)</span>
                <input
                  type="datetime-local" className="es-input es-input--sm" value={r.startsAt}
                  onChange={(e) => update(r.key, { startsAt: e.target.value })}
                />
              </label>
              <label className="es-ai-field">
                <span className="text-xs text-subtle">Where (optional)</span>
                <input
                  className="es-input es-input--sm" value={r.location} maxLength={120} placeholder="e.g. Main stage"
                  onChange={(e) => update(r.key, { location: e.target.value })}
                />
              </label>
              <span className="es-ai-schedrow__tools">
                <button type="button" className="es-ai-iconbtn es-ai-iconbtn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.title || 'item'} up`}><NavIcon name="chevronUp" size={16} /></button>
                <button type="button" className="es-ai-iconbtn es-ai-iconbtn--sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.title || 'item'} down`}><NavIcon name="chevronDown" size={16} /></button>
                <button type="button" className="es-ai-iconbtn es-ai-iconbtn--sm" onClick={() => set({ schedule: rows.filter((x) => x.key !== r.key) })} aria-label={`Remove ${r.title || 'item'}`}><NavIcon name="trash" size={16} /></button>
              </span>
              {error && <p className="text-xs text-danger es-ai-field--wide">{error}</p>}
            </li>
          );
        })}
      </ol>
      <button type="button" className="es-ai-add" onClick={() => set({ schedule: [...rows, newScheduleRow()] })} disabled={rows.length >= 50}>
        <NavIcon name="plus" size={16} /> Add to schedule
      </button>
    </div>
  );
}
