'use client';

import { useId } from 'react';

/**
 * A labelled input.
 *
 * The label is a real `<label for>`, not a placeholder. A placeholder-as-label
 * disappears the moment someone types, so anyone who looks away mid-form has to
 * clear the field to find out what it wanted — and screen readers get nothing
 * at all on some browsers.
 *
 * `useId` rather than a caller-supplied id: two of these on one page with the
 * same name (a password and its confirmation) would otherwise share an id, and
 * clicking one label focuses the other.
 */
export default function Field({
  label, hint, error, type = 'text', ...props
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>

      <input
        id={id}
        type={type}
        // Both are announced, and `aria-invalid` is what makes a screen reader
        // say "invalid" rather than leaving the red border as the only signal.
        aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? 'true' : undefined}
        // The red border comes from `.es-input[aria-invalid]` above, driven by
        // the same attribute the screen reader reads — so the two cannot be
        // set independently and disagree.
        className="es-input"
        {...props}
      />

      {hint && !error && <p id={hintId} className="text-xs text-subtle">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  );
}
