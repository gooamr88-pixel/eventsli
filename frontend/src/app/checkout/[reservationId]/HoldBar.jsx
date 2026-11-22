'use client';

import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hold banner across the top of the checkout (redone 2026-11-22, owner:
 * "enhance it more professionally").
 *
 * What is held and why the clock matters on the left; the time as a clock
 * face (mm:ss) in its own pill on the right, so it reads in a glance. It warms
 * as the hold runs down — amber under five minutes, red under one — and says
 * plainly when the hold is gone. A thin bar under it empties with the time.
 *
 * `remaining` (and `totalMs`) arrive from the page (useCountdown): reading
 * Date.now() during render is impure, and the value already ticks there.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HoldBar({
  expired, remaining, totalMs = null,
  /* What is on hold, in words — `heldNoun(reservation)`. */
  noun = { one: 'seat', many: 'seats', they: 'they' },
}) {
  if (remaining === null || remaining === undefined) return null;
  const urgent = !expired && remaining <= 60_000;
  const warning = !expired && !urgent && remaining <= 5 * 60_000;
  const tone = expired ? 'expired' : urgent ? 'urgent' : warning ? 'warning' : 'calm';
  const min = Math.floor(remaining / 60_000);
  const sec = Math.floor((remaining % 60_000) / 1000);
  const left = totalMs ? Math.max(0, Math.min(1, remaining / totalMs)) : null;
  const is = noun.they === 'it' ? 'is' : 'are';

  return (
    <div className={`es-co-timer es-co-timer--${tone}`} role="timer" aria-live={urgent ? 'polite' : 'off'}>
      <span className="es-co-timer__icon" aria-hidden="true"><NavIcon name={expired ? 'clock' : 'lock'} size={20} /></span>
      <div className="es-co-timer__text fx-min0">
        {expired ? (
          <>
            <b>Your {noun.many} {noun.they === 'it' ? 'has' : 'have'} been released</b>
            <span>The hold ran out. Nothing was charged.</span>
          </>
        ) : (
          <>
            <b>Your {noun.many} {is} held for you</b>
            <span>Complete your booking before the timer ends.</span>
          </>
        )}
      </div>
      {!expired && (
        <span className="es-co-timer__clock es-nums">
          <span className="sr-only">Time left: {min} minutes {sec} seconds</span>
          <span aria-hidden="true">{String(min).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>
        </span>
      )}
      {left !== null && !expired && (
        <span className="es-co-timer__track" aria-hidden="true"><span style={{ transform: `scaleX(${left})` }} /></span>
      )}
    </div>
  );
}
