'use client';

/**
 * 2D · 3D · 360° — the three ways to look at one room. A radio group, because
 * exactly one is on: arrow keys move between them, as a screen reader expects.
 */
const VIEWS = [
  { key: '2d', label: '2D', hint: 'Seat map' },
  { key: '3d', label: '3D', hint: 'The venue in 3D' },
  { key: '360', label: '360°', hint: 'The view from a seat' },
];

export default function ViewSwitch({ value, onChange, label = 'How to view the venue' }) {
  const onKey = (e) => {
    const i = VIEWS.findIndex((v) => v.key === value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = VIEWS[(i + step + VIEWS.length) % VIEWS.length];
    onChange(next.key);
    e.currentTarget.querySelector(`[data-view="${next.key}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="es-viewswitch" onKeyDown={onKey}>
      {VIEWS.map((v) => {
        const on = v.key === value;
        return (
          <button
            key={v.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-view={v.key}
            title={v.hint}
            onClick={() => onChange(v.key)}
            className="es-viewswitch__opt"
          >
            <ViewGlyph view={v.key} />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

function ViewGlyph({ view }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (view === '2d') {
    return <svg {...common}><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></svg>;
  }
  if (view === '3d') {
    return <svg {...common}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 22V12M21 7l-9 5-9-5" /></svg>;
  }
  return <svg {...common}><path d="M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7" /><path d="M3 12V8M3 12h4" /><circle cx="12" cy="12" r="2" /></svg>;
}
