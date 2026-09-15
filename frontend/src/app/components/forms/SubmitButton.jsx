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
 *
 * `disabled` and `className` are taken out of the rest props on purpose. They
 * used to be spread AFTER the computed values, so any caller passing
 * `disabled={false}` — which is every form with a validity check — switched the
 * busy lock back off and a second click sent the request twice.
 */
export default function SubmitButton({
  busy, busyLabel, children, disabled, variant = 'primary', className = '', ...props
}) {
  return (
    <button
      type="submit"
      {...props}
      disabled={Boolean(busy || disabled)}
      aria-busy={busy || undefined}
      className={`es-btn es-btn--${variant} ${className}`.trim()}
    >
      {busy ? (busyLabel || 'Working…') : children}
    </button>
  );
}
