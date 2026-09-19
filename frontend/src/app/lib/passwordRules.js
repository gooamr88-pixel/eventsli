/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A PASSWORD — stated once, for the four screens that ask.
 *
 * Sign-up, organizer sign-up, the reset form and the change-password panel each
 * carried their own `const MIN_PASSWORD = 12`, their own "At least 12
 * characters" hint and their own countdown message. Four copies of one rule
 * that the API is the actual authority on: `passwordRules` in
 * `backend/routes/authRoutes.js` refuses anything under 12 and over 200.
 *
 * Four copies do not drift while nobody touches them. They drift on the day the
 * API raises the minimum — and the failure is quiet and unpleasant: the form
 * accepts what it believes is fine, the server refuses it, and somebody is told
 * their password is wrong on the screen where they are choosing it.
 *
 * `MAX` mirrors the API's ceiling for the same reason. It is generous rather
 * than restrictive — the hash does not care — and it exists so a paste of
 * something enormous is caught in the browser instead of by a 400.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 200;

/** The hint under the field. One sentence, the same on every screen. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A short phrase works well.`;

/**
 * What to say while it is too short, or `null` when it is fine.
 *
 * Counts DOWN rather than repeating the rule: somebody who has typed nine
 * characters already knows the minimum is twelve — what they want to know is
 * that three more will do it.
 */
export function passwordProblem(value) {
  const length = String(value || '').length;
  if (length === 0 || length >= MIN_PASSWORD) return null;
  const missing = MIN_PASSWORD - length;
  return `${missing} more to go.`;
}
