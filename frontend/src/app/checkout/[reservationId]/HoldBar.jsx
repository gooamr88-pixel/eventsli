'use client';

/**
 * The countdown on the hold.
 *
 * Its whole job is that `RESERVATION_EXPIRED` is never a surprise. Arriving as
 * a red wall on the payment button is the worst possible moment to learn the
 * seats went back on sale — the buyer has already entered their details and
 * committed to the purchase in their head.
 *
 * So the number is visible the entire time, and it changes character twice: at
 * five minutes it warns, at one it goes urgent. Those are the two points where
 * a person can still do something about it.
 */
export default function HoldBar({ formatted, expired, remaining }) {
  // `remaining` arrives from useCountdown rather than being recomputed here.
  // Calling Date.now() during a render is impure — the same render can produce
  // two different results — and the value is already on the right beat.
  if (remaining === null || remaining === undefined) return null;

  const urgent = !expired && remaining <= 60_000;
  const warning = !expired && !urgent && remaining <= 5 * 60_000;

  const tone = expired
    ? 'border-danger/40 bg-danger/10'
    : urgent
      ? 'border-danger/40 bg-danger/5'
      : warning
        ? 'border-warning/40 bg-warning/10'
        : 'border-border-base bg-surface';

  return (
    <div
      className={`fx-row fx-row--between rounded-[--es-radius-md] border px-4 py-2.5 ${tone}`}
      // Polite, not assertive: this updates every second, and an assertive
      // region would have a screen reader interrupt itself sixty times a
      // minute. The two threshold changes below carry the urgency instead.
      aria-live="polite"
    >
      <span className="text-muted">
        {expired ? 'Your seats have been released' : 'Seats held for'}
      </span>
      {!expired && (
        /* `text-xl`, up from `text-lg`. This is a number that is counting down
           on a page where the person is typing card details: it has to be
           readable in peripheral vision, from a glance, without leaving the
           field they are in. The three tones already carry urgency; the size
           is what makes the glance work at all. */
        <span
          className={`es-nums font-mono text-xl font-medium ${urgent ? 'text-danger' : warning ? 'text-warning' : 'text-accent'}`}
        >
          {formatted}
        </span>
      )}
    </div>
  );
}
