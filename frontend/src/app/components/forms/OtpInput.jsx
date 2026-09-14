'use client';

import { useRef } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Six boxes for a one-time code.
 *
 * Fancy's OtpBoxes behaviour — auto-advance, backspace to the previous box,
 * paste splitting — with two things it lacked:
 *
 *   · The phone's autofill. iOS and Android offer the code from the email or
 *     SMS as a suggestion on the FIRST field (`autocomplete="one-time-code"`)
 *     and put all six digits into it at once. That box accepts six characters
 *     and spreads them; a `maxLength` of 1 there would keep only the first.
 *   · No inline styles and no styled-jsx: the look is `.es-otp` in globals.css,
 *     where the contrast gate can see it.
 *
 * Deleting a digit in the middle closes the gap rather than leaving a hole, so
 * the value is always the digits typed, in order — exactly what the API wants.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OtpInput({
  value = '',
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  label = 'Verification code',
  autoFocus = false,
}) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const focus = (i) => refs.current[Math.max(0, Math.min(i, length - 1))]?.focus();

  function write(index, text) {
    const clean = String(text).replace(/\D/g, '');
    if (!clean) return;
    const next = digits.slice(0, index);
    // Everything before the box stays; the typed or pasted digits land from it.
    const joined = `${next.join('')}${clean}`.slice(0, length);
    onChange(joined);
    focus(joined.length);
    if (joined.length === length) onComplete?.(joined);
  }

  function erase(index) {
    const next = digits.filter((_, i) => i !== index).join('');
    onChange(next);
  }

  function onKeyDown(index, e) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) erase(index);
      else if (index > 0) { erase(index - 1); focus(index - 1); }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(index + 1);
    }
  }

  return (
    <div className="es-otp" role="group" aria-label={label}>
      {digits.map((digit, i) => (
        <input
          // Position IS identity here; the boxes never reorder.
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="es-otp__box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? length : 1}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          // Only the first box, and only when asked: autofocus elsewhere steals
          // a screen reader's place on the page.
          autoFocus={autoFocus && i === 0}
          // A box that already holds a digit and gets focus should be ready to
          // be typed over, not appended to.
          onFocus={(e) => e.target.select()}
          onChange={(e) => write(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => { e.preventDefault(); write(i, e.clipboardData.getData('text')); }}
        />
      ))}
    </div>
  );
}
