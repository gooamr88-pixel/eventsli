'use client';

import { useId, useState } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INSPECTOR: ONE SHAPE FOR EVERY PANEL BESIDE THE MAP (2026-11-21).
 *
 * A table, an area, a group, the wall tool and the map itself each had a panel
 * of its own design: two card styles, three heading sizes, "Remove" at the top
 * of one and "Remove all" at the bottom of the next, and fifteen fields in one
 * flat column with the money below the colours. Every panel is now:
 *
 *   HEAD     what this is — an icon, a name, one line of facts, a status.
 *   SECTIONS grouped by the job, most important first, each one folding.
 *   ACTIONS  the same footer in the same place, pinned to the panel's bottom
 *            edge so Delete is never a scroll away, and never at the top where
 *            a hand reaching for the first field finds it.
 *
 * WHY SECTIONS REMEMBER WHETHER THEY ARE OPEN. An organizer pricing forty
 * tables opens "Tickets & price" and wants it open on the next table too, not
 * folded back to the default on every click. The state is kept per section
 * for the session (and in the browser where storage works), keyed by `id`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const remembered = new Map();
const STORE_KEY = 'es-mapinspector';

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function initialOpen(id, fallback) {
  if (remembered.has(id)) return remembered.get(id);
  if (typeof window !== 'undefined') {
    const stored = readStored();
    if (typeof stored[id] === 'boolean') return stored[id];
  }
  return fallback;
}

function remember(id, open) {
  remembered.set(id, open);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStored(), [id]: open }));
  } catch { /* a private window: the session Map still remembers it */ }
}

/** Back to every section's default — for tests, which share one module. */
export function forgetSections() {
  remembered.clear();
}

export function Inspector({ icon = null, title, meta = null, status = null, children, actions = null, label = null }) {
  const headId = useId();
  return (
    <aside className="es-dcard es-insp" aria-labelledby={headId}>
      <header className="es-insp__head">
        {icon && <span className="es-insp__icon" aria-hidden="true">{icon}</span>}
        <div className="fx-min0 flex-1">
          {label && <p className="es-insp__eyebrow">{label}</p>}
          <h2 id={headId} className="es-insp__title">{title}</h2>
          {meta && <p className="es-insp__meta">{meta}</p>}
        </div>
      </header>
      {status}
      <div className="es-insp__body">{children}</div>
      {actions && <footer className="es-insp__actions">{actions}</footer>}
    </aside>
  );
}

/**
 * One folding group of fields. `summary` is what it says while folded ("Round
 * · 10 seats"), so a closed section still tells the reader what is inside.
 * `id` names it for the remembered open state; `forceOpen` OPENS it on mount
 * whatever was remembered (a private table opens its Access section) — and
 * then it folds like any other, rather than ignoring the reader's click.
 * `className` lets a host show a section at some widths only.
 */
export function InspectorSection({ id, title, summary = null, defaultOpen = true, forceOpen = false, className = '', children }) {
  const [open, setOpen] = useState(() => forceOpen || initialOpen(id, defaultOpen));
  const bodyId = useId();
  const shown = open;
  const toggle = () => {
    const next = !shown;
    setOpen(next);
    remember(id, next);
  };
  return (
    <section className={`es-insp__sec ${className}`.trim()} data-open={shown ? 'true' : 'false'}>
      <h3 className="es-insp__sechead">
        <button type="button" className="es-insp__toggle" aria-expanded={shown} aria-controls={bodyId} onClick={toggle}>
          <span className="es-insp__sectitle">{title}</span>
          {!shown && summary && <span className="es-insp__summary">{summary}</span>}
          <NavIcon name="chevronDown" size={16} className="es-insp__chev" />
        </button>
      </h3>
      {/* Folded, the fields are not rendered at all: everything they show
          lives in the draft, and a long room's inspector stays light. */}
      <div id={bodyId} className="es-insp__secbody" hidden={!shown}>
        {shown && children}
      </div>
    </section>
  );
}

/** A footer button. `tone="danger"` for Delete; `primary` for Finish. */
export function InspectorAction({ icon, children, onClick, disabled = false, tone = null, primary = false, title = null, label = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || undefined}
      aria-label={label || undefined}
      className={`es-insp__act${tone === 'danger' ? ' es-insp__act--danger' : ''}${primary ? ' es-insp__act--primary' : ''}`}
    >
      {icon && <NavIcon name={icon} size={17} />}
      <span>{children}</span>
    </button>
  );
}

/**
 * A getting-started checklist (2026-11-21): numbered steps that tick
 * themselves off from the draft, the next one marked, each with the one
 * button that does it. Both map editors open with one while nothing is
 * selected, so a first map needs no knowledge of where things live.
 */
export function Checklist({ children }) {
  return <ol className="es-checklist">{children}</ol>;
}

export function ChecklistStep({ n, done, current, title, detail, children }) {
  return (
    <li className="es-checklist__step" data-state={done ? 'done' : current ? 'current' : 'todo'}>
      <span className="es-checklist__mark" aria-hidden="true">{done ? <NavIcon name="tick" size={14} /> : n}</span>
      <div className="es-checklist__body">
        <p className="es-checklist__title">
          {title}
          <span className="sr-only">{done ? ' — done' : current ? ' — next' : ''}</span>
        </p>
        {detail && <p className="es-checklist__detail">{detail}</p>}
        {children}
      </div>
    </li>
  );
}

/** A quiet line of guidance inside a section — never more than one or two. */
export function InspectorNote({ children, tone = null }) {
  return <p className={`es-insp__note${tone ? ` es-insp__note--${tone}` : ''}`}>{children}</p>;
}
