'use client';

import { useState } from 'react';
import NavIcon from '../../shell/NavIcon';

const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

/**
 * The weekly hours, on the host's clock: each day closed or open, with one or
 * more windows ("9:00–12:00, 13:00–17:00"). The API cleans what is saved —
 * merges overlaps, drops a window that ends before it starts.
 */
export function WeeklyHoursEditor({ value, onChange }) {
  const setDay = (day, windows) => onChange({ ...value, [day]: windows });
  return (
    <div className="es-demo-hours">
      {DAYS.map(([day, label]) => {
        const windows = value[day] || [];
        const open = windows.length > 0;
        return (
          <div key={day} className="es-demo-hours__day">
            <label className="es-demo-hours__toggle">
              <input type="checkbox" checked={open} onChange={(e) => setDay(day, e.target.checked ? [['09:00', '17:00']] : [])} />
              <span>{label}</span>
            </label>
            <div className="es-demo-hours__windows">
              {!open && <span className="es-demo-hours__closed">Closed</span>}
              {windows.map(([from, to], i) => (
                <div key={i} className="es-demo-hours__window">
                  <input type="time" className="es-input" aria-label={`${label} from`} value={from}
                    onChange={(e) => setDay(day, windows.map((w, j) => (j === i ? [e.target.value, w[1]] : w)))} />
                  <span aria-hidden>–</span>
                  <input type="time" className="es-input" aria-label={`${label} until`} value={to}
                    onChange={(e) => setDay(day, windows.map((w, j) => (j === i ? [w[0], e.target.value] : w)))} />
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-label={`Remove this ${label} window`}
                    onClick={() => setDay(day, windows.filter((_, j) => j !== i))}>
                    <NavIcon name="close" size={16} />
                  </button>
                </div>
              ))}
              {open && windows.length < 6 && (
                <button type="button" className="es-btn es-btn--ghost es-btn--sm es-demo-hours__add"
                  onClick={() => setDay(day, [...windows, ['13:00', '17:00']])}>
                  <NavIcon name="plus" size={16} /> Add hours
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Days with no demos at all — holidays, a trade show. */
export function BlockedDatesEditor({ value, onChange }) {
  const [date, setDate] = useState('');
  const add = () => {
    if (!date || value.includes(date)) return;
    onChange([...value, date].sort());
    setDate('');
  };
  return (
    <div className="es-demo-chips">
      <div className="es-demo-chips__add">
        <input type="date" className="es-input" aria-label="Date to block" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={add} disabled={!date}>Block this day</button>
      </div>
      {value.length > 0 ? (
        <ul className="es-demo-chips__list">
          {value.map((d) => (
            <li key={d}>
              {new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
              <button type="button" aria-label={`Unblock ${d}`} onClick={() => onChange(value.filter((x) => x !== d))}>
                <NavIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="es-demo-admin__small">No blocked days.</p>}
    </div>
  );
}

/** A short list of strings (topics, notification emails). */
export function TextListEditor({ value, onChange, placeholder, addLabel, type = 'text', max = 15 }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t || value.includes(t) || value.length >= max) return;
    onChange([...value, t]);
    setText('');
  };
  return (
    <div className="es-demo-chips">
      <div className="es-demo-chips__add">
        <input type={type} className="es-input" placeholder={placeholder} value={text} maxLength={254}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={add} disabled={!text.trim() || value.length >= max}>{addLabel}</button>
      </div>
      {value.length > 0 && (
        <ul className="es-demo-chips__list">
          {value.map((t) => (
            <li key={t}>
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
                <NavIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
