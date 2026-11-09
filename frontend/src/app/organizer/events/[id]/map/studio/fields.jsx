'use client';

import { useId } from 'react';

/**
 * The Venue Studio's form controls: label above, hint below, the product's
 * `.es-input`. Small on purpose — the studio's panels are dense, and a field
 * that brings its own layout fights the panel it sits in.
 */
export function Field({ label, hint, children, id }) {
  return (
    <div className="fx-stack gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      {children}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, value, onChange, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <input id={id} className="es-input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function NumberField({ label, hint, value, onChange, min, max, step = 1, suffix }) {
  const id = useId();
  const clampTo = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, step < 1 ? Math.round(n / step) * step : Math.round(n)));
  };
  return (
    <Field label={label} hint={hint} id={id}>
      <span className="es-studio-num">
        <input
          id={id} type="number" inputMode="decimal" className="es-input" value={value} min={min} max={max} step={step}
          // Held to the bounds on commit, not per keystroke, so "12" can be
          // typed through "1" when the minimum is 2.
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          onBlur={(e) => onChange(clampTo(e.target.value))}
        />
        {suffix && <span className="es-studio-num__suffix" aria-hidden="true">{suffix}</span>}
      </span>
    </Field>
  );
}

export function SelectField({ label, hint, value, onChange, options }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} className="es-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export function RangeField({ label, hint, value, onChange, min, max, step = 1, format = (v) => v }) {
  const id = useId();
  return (
    <div className="fx-stack gap-1.5">
      <div className="fx-row fx-row--between">
        <label htmlFor={id} className="text-sm text-ink">{label}</label>
        <output htmlFor={id} className="es-nums text-sm text-muted">{format(value)}</output>
      </div>
      <input id={id} type="range" className="es-range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  const id = useId();
  return (
    <div className="fx-row fx-row--between items-start gap-3">
      <span className="fx-min0">
        <label htmlFor={id} className="block text-sm text-ink">{label}</label>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className="es-studio-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

/** A row of mutually exclusive choices, as a radio group of chips. */
export function Choice({ label, value, onChange, options }) {
  const name = useId();
  return (
    <fieldset className="fx-stack gap-1.5">
      <legend className="mb-1.5 text-sm text-ink">{label}</legend>
      <div className="fx-row gap-2">
        {options.map((o) => (
          <label key={o.key} className={`es-chip ${value === o.key ? 'es-chip--on' : ''}`} title={o.hint}>
            <input type="radio" name={name} value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
