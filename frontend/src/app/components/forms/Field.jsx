'use client';

import { useId, useState } from 'react';

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
 *
 * A `type="password"` field grows an eye. Every password box in the app is one
 * of these, so the toggle arrives on all of them at once — sign in, register,
 * reset, and the change-password form in account settings — without any of
 * them opting in.
 */
export default function Field({
  label, hint, error, type = 'text', ...props
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const isPassword = type === 'password';
  const [revealed, setReveal] = useState(false);

  const input = (
    <input
      id={id}
      // Only the RENDERED type flips. `isPassword` is remembered separately, so
      // revealing the text does not also remove the eye that put it back.
      type={isPassword && revealed ? 'text' : type}
      // Both are announced, and `aria-invalid` is what makes a screen reader
      // say "invalid" rather than leaving the red border as the only signal.
      aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? 'true' : undefined}
      // The red border comes from `.es-input[aria-invalid]` above, driven by
      // the same attribute the screen reader reads — so the two cannot be
      // set independently and disagree.
      className={`es-input${isPassword ? ' es-input--reveal' : ''}`}
      {...props}
    />
  );

  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>

      {isPassword ? (
        <div className="es-input-wrap">
          {input}
          <button
            type="button"
            className="es-input-reveal"
            // The control's name has to say what it DOES, and what it does
            // changes with its state — "Show password" while hidden. A static
            // "Toggle password" leaves a screen reader user to guess which way
            // it is about to go.
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            onClick={() => setReveal((v) => !v)}
          >
            <EyeIcon off={revealed} />
          </button>
        </div>
      ) : input}

      {hint && !error && <p id={hintId} className="text-xs text-subtle">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Decorative: the button beside it carries the name. */
function EyeIcon({ off }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}
