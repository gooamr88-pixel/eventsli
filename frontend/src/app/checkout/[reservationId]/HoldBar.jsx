'use client';

import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The banner across the top of the checkout: "Your cart will expire in 18 min
 * 30 sec" (owner's reference, 2026-11-15).
 *
 * Minutes and seconds as WORDS with the numbers in the accent, rather than a
 * "17:59" clock: a buyer typing an email reads it in a glance without parsing
 * a time. It warms as the hold runs down — amber under five minutes, red
 * under one — and says plainly when the hold is gone.
 *
 * `remaining` arrives from the page (useCountdown) rather than being computed
 * here: reading Date.now() during render is impure, and the value already
 * exists on the same one-second beat.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HoldBar({
  expired, remaining,
  /* What is on hold, in words — `heldNoun(reservation)`. */
  noun = { one: 'seat', many: 'seats', they: 'they' },
}) {
  if (remaining === null || remaining === undefined) return null;
  const urgent = !expired && remaining <= 60_000;
  const warning = !expired && !urgent && remaining <= 5 * 60_000;
  const tone = expired ? 'expired' : urgent ? 'urgent' : warning ? 'warning' : 'calm';
  const min = Math.floor(remaining / 60_000);
  const sec = Math.floor((remaining % 60_000) / 1000);

  return (
    <p className={`es-co-timer es-co-timer--${tone}`} role="timer" aria-live={urgent ? 'polite' : 'off'}>
      <NavIcon name="clock" size={20} />
      {expired ? (
        <span>Your {noun.many} {noun.they === 'it' ? 'has' : 'have'} been released</span>
      ) : (
        <span>
          Your cart will expire in{' '}
          <b className="es-nums">{min}</b> min <b className="es-nums">{String(sec).padStart(2, '0')}</b> sec
        </span>
      )}
    </p>
  );
}
