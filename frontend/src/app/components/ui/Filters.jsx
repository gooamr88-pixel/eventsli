'use client';

import { useId, useState } from 'react';

/**
 * The controls above a list: one-of-several filters, a search box, and paging.
 *
 * Kept together because they are always used together, and because the three
 * of them were written out by hand on every admin page — each with its own
 * pill style and its own idea of when a search runs.
 */

/**
 * One-of-several. Buttons with `aria-pressed` rather than radio inputs: the
 * choice applies immediately, and that is what a toggle button promises.
 */
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="es-segmented" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value || 'all'}
          type="button"
          className="es-segmented__option"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.count !== undefined && opt.count !== null && (
            <span className="es-segmented__count">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Searches on Enter or on the button — not on every keystroke. Each keystroke
 * would be a request, and on the console several of these lists count across
 * the whole platform.
 */
export function SearchBox({ label, placeholder, value = '', onSearch }) {
  const id = useId();
  const [text, setText] = useState(value);

  // A parent clearing the search (a "reset filters" link) has to clear the box.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  return (
    <form
      role="search"
      className="fx-row fx-min0 flex-1"
      onSubmit={(e) => { e.preventDefault(); onSearch(text.trim()); }}
    >
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        className="es-input fx-min0 flex-1"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="es-btn es-btn--secondary">Search</button>
    </form>
  );
}

/** Previous / next with a count. Hidden entirely when everything fits on one page. */
export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <nav className="fx-row fx-row--between" aria-label="Pages">
      {/* `aria-live`, because pressing Next changes a table somewhere above
          this line and says nothing. Focus stays on the button — correctly, so
          a second press works — which leaves a screen reader user with no
          signal that anything happened at all. Polite: it is a confirmation,
          not an interruption, and the row it sits in is already the answer. */}
      <p className="es-nums text-sm text-muted" aria-live="polite">
        Page {page} of {totalPages} · {total} in all
      </p>
      <div className="fx-row">
        <button
          type="button"
          className="es-btn es-btn--secondary es-btn--sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="es-btn es-btn--secondary es-btn--sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
