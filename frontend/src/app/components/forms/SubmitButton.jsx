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
      className="rounded-[--es-radius-md] bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      {busy ? (busyLabel || 'Working…') : children}
    </button>
  );
}
