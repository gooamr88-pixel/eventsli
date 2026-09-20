'use client';

import { useId } from 'react';
import Field from './Field';
import {
  MIN_PASSWORD, MAX_PASSWORD, passwordChecks, passwordStrength,
} from '../../lib/passwordRules';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CHOOSING a password — the whole control, for the four screens that ask.
 *
 * Sign-up, organizer sign-up, the reset form and the change-password panel all
 * rendered a bare `<Field type="password">` with a hint under it. That is a
 * correct input and an incomplete answer: it says what the rule is, and it does
 * not say whether you have met it, so the way to find out was to submit.
 *
 * WHAT THIS ADDS, and what each part is for:
 *
 *   The meter       a rough band, so a reader can tell "long enough" from
 *                   "actually good" without reading a checklist.
 *   The checklist   the rules, each one live. This is the part that removes
 *                   the round trip — every requirement the server will apply
 *                   is visible and ticks as it is met.
 *   The confirm     a second entry, so a typo in a password nobody can read
 *                   back is caught here and not at the next sign-in.
 *
 * `Field` already carries the label, the show/hide eye, `aria-invalid` and the
 * error wiring; none of that is re-implemented. The checklist is joined to the
 * input through `describedBy`, so a screen reader reaching the box hears the
 * requirements rather than discovering a list of ticks somewhere after it.
 *
 * THE METER IS NOT A VERDICT. It is `aria-hidden` and the word beside it is
 * what gets announced, because a bar that is 3/4 full means nothing read
 * aloud. It never says "secure": the server's blocklist decides, and a meter
 * that promises safety it cannot check is worse than no meter.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function NewPasswordFields({
  value,
  onChange,
  /** Omit entirely to render no confirmation field. */
  confirm,
  onConfirmChange,
  /** Used only to refuse a password containing it — the same rule the API has. */
  email,
  label = 'Password',
  confirmLabel = 'Confirm password',
  /** A server-side error for the password field itself. */
  error,
  autoComplete = 'new-password',
  name = 'password',
  confirmName = 'confirmPassword',
}) {
  const listId = useId();
  const meterId = useId();

  const hasConfirm = confirm !== undefined;
  const checks = passwordChecks(value, { email, confirm: hasConfirm ? confirm : undefined });
  const strength = passwordStrength(value, { email });

  const typed = String(value || '').length > 0;
  const mismatch = hasConfirm && confirm.length > 0 && value !== confirm;

  return (
    <div className="fx-stack fx-stack--sm">
      <Field
        label={label}
        type="password"
        name={name}
        autoComplete={autoComplete}
        required
        minLength={MIN_PASSWORD}
        maxLength={MAX_PASSWORD}
        value={value}
        onChange={onChange}
        error={error}
        // The checklist IS the hint, so there is no `hint` prop — two
        // descriptions of the same rule, one prose and one ticked, is the
        // duplication this component replaces.
        describedBy={`${meterId} ${listId}`}
      />

      {typed && (
        <div className="es-pw">
          {/* The bar is furniture. The word is the content. */}
          <div
            aria-hidden="true"
            className="es-pw__track"
            data-score={strength.score}
          >
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className="es-pw__step"
                data-on={step <= strength.score ? 'true' : undefined}
              />
            ))}
          </div>
          {/* `polite`, so it reports the band as it changes without cutting
              across whatever the reader is already hearing. */}
          <p id={meterId} className="es-pw__label" aria-live="polite">
            Password strength: {strength.label}
          </p>
        </div>
      )}

      <ul id={listId} className="es-pw__rules">
        {checks.map((check) => (
          <li key={check.id} data-met={check.met === null ? undefined : String(check.met)}>
            {/* The mark is decorative — `met` is already in the text through
                the `sr-only` word, so a reader is not asked to interpret a
                symbol they cannot see. */}
            <span aria-hidden="true" className="es-pw__mark">
              {check.met === true ? '✓' : check.met === false ? '✕' : '•'}
            </span>
            <span>
              {check.met !== null && (
                <span className="sr-only">{check.met ? 'Met: ' : 'Not met: '}</span>
              )}
              {check.label}
            </span>
          </li>
        ))}
      </ul>

      {hasConfirm && (
        <Field
          label={confirmLabel}
          type="password"
          name={confirmName}
          autoComplete={autoComplete}
          required
          maxLength={MAX_PASSWORD}
          value={confirm}
          onChange={onConfirmChange}
          // Shown only once there is something to disagree with, so it does not
          // accuse somebody of a mismatch while they are still typing the
          // first character of the second box.
          error={mismatch ? 'These do not match yet.' : undefined}
        />
      )}
    </div>
  );
}
