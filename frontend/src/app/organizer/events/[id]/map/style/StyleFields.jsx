'use client';

/**
 * The small controls every style panel shares (tables, areas, walls, the map's
 * look): a colour with a way back to the default, a slider with its value, a
 * − n + stepper and a row of choices. One copy, so the four panels behave alike.
 */

/** A colour. `value` null means "the default" (`fallback` is what the picker
 *  shows then); Default puts it back. */
export function ColourField({ id, label, value, fallback = '#888888', onChange, emptyText = 'Default', noReset = false }) {
  return (
    <div className="fx-row items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <span className="fx-row items-center gap-1.5">
        {!value && <span className="text-xs text-subtle">{emptyText}</span>}
        <input
          id={id}
          type="color"
          className="es-colourswatch"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
        />
        {!noReset && value && (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange(null)}>
            Reset
          </button>
        )}
      </span>
    </div>
  );
}

export function RangeField({ label, min, max, step = 1, value, onChange, format = (v) => v }) {
  const id = `rf-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-row items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <span className="fx-row items-center gap-2">
        <input
          id={id}
          type="range" min={min} max={max} step={step} value={value}
          className="es-stylerange"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="es-nums w-9 text-end text-xs text-subtle">{format(Math.round(value * 10) / 10)}</span>
      </span>
    </div>
  );
}

export function Stepper({ label, value, onChange, canAdd = true, canRemove = true }) {
  return (
    <div className="fx-row items-center justify-between gap-2">
      <span className="text-sm text-ink">{label}</span>
      <span className="es-stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`One fewer, ${label}`} disabled={!canRemove} onClick={() => onChange(value - 1)}>−</button>
        <span className="es-nums" aria-live="polite">{value}</span>
        <button type="button" aria-label={`One more, ${label}`} disabled={!canAdd} onClick={() => onChange(value + 1)}>+</button>
      </span>
    </div>
  );
}

/** A segmented choice: [[value, label], …]. */
export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="fx-row items-center justify-between gap-2">
      <span className="text-sm text-ink">{label}</span>
      <span className="es-seg" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
        ))}
      </span>
    </div>
  );
}
