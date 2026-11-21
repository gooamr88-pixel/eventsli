'use client';

import { useId, useState } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE SET OF CONTROLS FOR THE MAP EDITORS (2026-11-21): the seating map's
 * Venue Studio and the vendor floor plan, so the two editors an organizer
 * uses for one event read and behave alike.
 *
 * Before this there were two: `studio/fields.jsx` (label above, a full-width
 * slider, chips for a choice, a switch for yes/no) and `style/StyleFields.jsx`
 * (label beside, a 7rem slider, a black segmented control, checkboxes), plus a
 * private `<Select>` in the table panel and raw inputs in the zone panel. The
 * same idea — "pick one of three" — looked three different ways depending on
 * which panel it sat in, and an organizer had to relearn the screen per panel.
 *
 * The rules, so the next control added looks like the rest:
 *
 *   - TEXT, NUMBERS AND LISTS put the label ABOVE the control (`Field`).
 *   - SMALL CONTROLS put the label BESIDE it, on one line (`Row`): a colour, a
 *     switch, a stepper, a segmented choice. They are a row in a list.
 *   - A SLIDER is its label and value on one line, the track full width
 *     beneath — readable at the inspector's 18rem and the 3D panel's 20rem.
 *   - YES / NO IS ALWAYS A SWITCH (`Toggle`), never a bare checkbox.
 *   - ONE OF A FEW IS ALWAYS `Segmented`. Several-of-many is chips (`Chips`).
 *   - A HINT IS ONE SHORT LINE, and only where the field has a consequence
 *     (money, privacy, deleting seats). Everything else explains itself.
 *
 * Every id comes from `useId`, so two panels with a "Border thickness" can be
 * on the page at once without sharing one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Label above, hint below. */
export function Field({ label, hint, error, id, children, aside = null }) {
  return (
    <div className="es-field">
      <div className="es-field__head">
        <label htmlFor={id} className="es-field__label">{label}</label>
        {aside}
      </div>
      {children}
      {error ? <p className="es-field__error" role="alert">{error}</p> : hint ? <p className="es-field__hint">{hint}</p> : null}
    </div>
  );
}

/** Label beside the control, on one line. */
export function Row({ label, htmlFor, hint, children }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="es-frow">
      <span className="es-frow__text">
        <Label {...(htmlFor ? { htmlFor } : {})} className="es-field__label">{label}</Label>
        {hint && <span className="es-field__hint">{hint}</span>}
      </span>
      <span className="es-frow__control">{children}</span>
    </div>
  );
}

export function TextField({ label, hint, error, value, onChange, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <input
        id={id} className="es-input es-input--dense" value={value ?? ''} aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)} {...rest}
      />
    </Field>
  );
}

/**
 * A number the organizer can actually TYPE.
 *
 * The field keeps its own text. It used to be bound straight to the value,
 * and every host that ignored an empty string (as it must — '' is not a
 * width) made the field snap back the moment it was cleared, so "58" could
 * only become "120" by selecting it all first. Now:
 *
 *   - while typing, a number inside the bounds is passed on at once (`live`),
 *     so the map follows; anything else ("", "1" on the way to "12") waits;
 *   - on blur or Enter the text is held to the bounds and committed.
 *
 * `live={false}` commits only on blur / Enter — for values whose every step
 * would redraw something large (the hall's size).
 */
export function NumberField({ label, hint, value, onChange, min, max, step = 1, suffix, live = true }) {
  const id = useId();
  const shown = value === '' || value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const [focused, setFocused] = useState(false);
  if (seen !== shown) {
    setSeen(shown);
    // A different value from outside (another item selected, a drag, an
    // undo) — never while the field has focus: then the change is the echo
    // of what is being typed, possibly rounded (metres to units and back),
    // and rewriting the text would fight the typist. Blur re-syncs.
    if (!focused && (text === '' || Number(text) !== Number(shown))) setText(shown);
  }
  const decimals = step < 1 ? String(step).split('.')[1]?.length || 1 : 0;
  const clampTo = (v) => {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) return Number(value) || min;
    const snapped = step < 1 ? Number((Math.round(n / step) * step).toFixed(decimals)) : Math.round(n);
    return Math.min(max, Math.max(min, snapped));
  };
  const inBounds = (t) => t !== '' && Number.isFinite(Number(t)) && Number(t) >= min && Number(t) <= max;
  const commit = () => {
    // Already applied while typing: show what the host kept (it may round).
    if (live && inBounds(text)) { setText(shown); return; }
    const n = clampTo(text);
    setText(String(n));
    if (n !== Number(value)) onChange(n);
  };
  return (
    <Field label={label} hint={hint} id={id}>
      <span className="es-studio-num">
        <input
          id={id} type="number" inputMode="decimal" className="es-input es-input--dense" value={text} min={min} max={max} step={step}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (live && inBounds(t)) onChange(step < 1 ? Number(t) : Math.round(Number(t)));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        />
        {suffix && <span className="es-studio-num__suffix" aria-hidden="true">{suffix}</span>}
      </span>
    </Field>
  );
}

/** `options`: [[value, label], …]. */
export function SelectField({ label, hint, value, onChange, options, disabled = false, placeholder = null }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} className="es-input es-input--dense" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export function RangeField({ label, hint, value, onChange, min, max, step = 1, format = (v) => v }) {
  const id = useId();
  return (
    <div className="es-field">
      <div className="es-field__head">
        <label htmlFor={id} className="es-field__label">{label}</label>
        <output htmlFor={id} className="es-field__value es-nums">{format(Math.round(Number(value) * 100) / 100)}</output>
      </div>
      <input
        id={id} type="range" className="es-range" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="es-field__hint">{hint}</p>}
    </div>
  );
}

/** Yes / no, always as a switch. The whole row is the target. */
export function Toggle({ label, hint, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <div className="es-frow es-frow--toggle">
      <span className="es-frow__text">
        <label htmlFor={id} className="es-field__label">{label}</label>
        {hint && <span className="es-field__hint">{hint}</span>}
      </span>
      <button
        id={id} type="button" role="switch" aria-checked={!!checked} disabled={disabled}
        className="es-switch es-switch--bare" onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" className="es-switch__track"><span className="es-switch__thumb" /></span>
      </button>
    </div>
  );
}

/** A colour; `value` null means "the default" (`fallback` is shown then). */
export function ColourField({ label, value, fallback = '#888888', onChange, emptyText = 'Default', noReset = false }) {
  const id = useId();
  return (
    <Row label={label} htmlFor={id}>
      {!value && <span className="es-field__muted">{emptyText}</span>}
      <input
        id={id} type="color" className="es-colourswatch" value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
      />
      {!noReset && (
        <button
          type="button" className="es-fbtn" aria-label={`Reset ${label.toLowerCase()} to ${emptyText.toLowerCase()}`}
          title="Reset" disabled={!value} onClick={() => onChange(null)}
        >
          <NavIcon name="undo" size={15} />
        </button>
      )}
    </Row>
  );
}

export function Stepper({ label, value, onChange, canAdd = true, canRemove = true }) {
  return (
    <Row label={label}>
      <span className="es-stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`One fewer, ${label}`} disabled={!canRemove} onClick={() => onChange(value - 1)}>−</button>
        <span className="es-nums" aria-live="polite">{value}</span>
        <button type="button" aria-label={`One more, ${label}`} disabled={!canAdd} onClick={() => onChange(value + 1)}>+</button>
      </span>
    </Row>
  );
}

/**
 * One of a few. `options`: [[value, label], …] or [{ key, label, hint, sub }].
 * `stacked` puts the label above and lets the buttons share the full width —
 * for the wider workspaces and for options that carry a second line (`sub`).
 */
export function Segmented({ label, value, options, onChange, stacked = false, disabled = false }) {
  const list = options.map((o) => (Array.isArray(o) ? { key: o[0], label: o[1] } : o));
  const group = (
    <span className={`es-seg${stacked ? ' es-seg--fill' : ''}`} role="group" aria-label={label}>
      {list.map((o) => (
        <button
          key={o.key} type="button" aria-pressed={value === o.key} title={o.hint} disabled={disabled || o.disabled}
          onClick={() => onChange(o.key)}
        >
          <span>{o.label}</span>
          {o.sub && <small className="es-nums">{o.sub}</small>}
        </button>
      ))}
    </span>
  );
  if (!stacked) return <Row label={label}>{group}</Row>;
  return (
    <div className="es-field">
      <span className="es-field__label">{label}</span>
      {group}
    </div>
  );
}

/** Several of many, as toggled chips. `items`: [{ key, label }]. */
export function Chips({ label, items, isOn, onToggle }) {
  return (
    <fieldset className="es-field">
      <legend className="es-field__label">{label}</legend>
      <div className="es-chips">
        {items.map((it) => {
          const on = isOn(it.key);
          return (
            <label key={it.key} className={`es-chip ${on ? 'es-chip--on' : ''}`}>
              <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onToggle(it.key, e.target.checked)} />
              {on && <NavIcon name="tick" size={14} />}
              {it.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Two short fields side by side (width and depth, length and thickness). */
export function Pair({ children }) {
  return <div className="es-fpair">{children}</div>;
}
