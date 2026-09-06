'use client';

import { describeError } from '../../utils/errors';

/**
 * The one place a form failure is rendered.
 *
 * Goes through `describeError`, so a code the API returns gets its own sentence
 * and its own recovery — `RATE_LIMITED` says to wait, `ACCOUNT_BANNED` says to
 * contact support, and neither reads as "your password was wrong".
 *
 * `role="alert"` so a screen reader announces it when it appears. Without it a
 * failed sign-in is silent: focus stays in the password field and nothing says
 * why nothing happened.
 */
export default function FormError({ error }) {
  if (!error) return null;
  const { title, recovery, code } = describeError(error);

  // VALIDATION_ERROR's generic title ("Check the details") adds nothing above
  // the server's specific message, which names the actual field.
  const showTitle = code !== 'VALIDATION_ERROR' && title !== recovery;

  return (
    <div role="alert" className="rounded-[--es-radius-md] bg-danger/10 px-3 py-2.5">
      {showTitle && <p className="text-sm font-medium text-ink">{title}</p>}
      <p className="text-sm text-muted">{recovery}</p>
    </div>
  );
}
