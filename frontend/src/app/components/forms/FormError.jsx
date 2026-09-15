'use client';

import { describeError, messageFor } from '../../utils/errors';

/**
 * The one place a form failure is rendered.
 *
 * The title comes from `describeError`, so a code gets its own heading —
 * `RATE_LIMITED` says to wait, `ACCOUNT_BANNED` says to contact support. The
 * sentence under it is the SERVER's message when there is one (`messageFor`):
 * it names the field or the rule, where the generic recovery line could only say
 * that something needs fixing.
 *
 * `role="alert"` so a screen reader announces it when it appears. Without it a
 * failed sign-in is silent: focus stays in the password field and nothing says
 * why nothing happened.
 */
export default function FormError({ error }) {
  if (!error) return null;
  const { title, code } = describeError(error);
  const message = messageFor(error);

  // VALIDATION_ERROR's generic title ("Check the details") adds nothing above
  // the server's specific message, which names the actual field.
  const showTitle = code !== 'VALIDATION_ERROR' && title !== message;

  return (
    <div role="alert" className="es-notice es-notice--danger">
      <div className="fx-stack fx-stack--sm gap-0.5">
        {showTitle && <p className="text-sm font-medium text-ink">{title}</p>}
        <p className="text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}
