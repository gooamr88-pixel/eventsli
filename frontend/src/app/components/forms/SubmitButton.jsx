'use client';

/**
 * A submit button that says what it is doing.
 *
 * `disabled` while busy is not politeness — the credential endpoints are rate
 * limited at 20 attempts per 15 minutes keyed on IP + email, so a double-click
 * spends two of someone's twenty on the same request.
 *
 * The label CHANGES rather than being replaced by a spinner, because a spinner
 * alone tells a screen reader nothing: `aria-busy` plus real text does.
 */
export default function SubmitButton({ busy, busyLabel, children, ...props }) {
  return (
    <button
      type="submit"
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className="es-btn es-btn--primary"
      {...props}
    >
      {busy ? (busyLabel || 'Working…') : children}
    </button>
  );
}
