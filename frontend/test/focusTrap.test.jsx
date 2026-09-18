import { describe, test, expect } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusablesIn, trapTab } from '../src/app/utils/focusTrap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The trap has to hold in the state every one of these dialogs OPENS in.
 *
 * Two of the three modals wrote the selector as `'button, input, …'` with no
 * `:not([disabled])`. That reads as correct and is correct for most of a
 * dialog's life — it only fails while the LAST control is disabled, which is
 * exactly the moment the dialog appears: Continue and Unlock are both disabled
 * until their field is filled.
 *
 * In that state the old code computed `last` as the disabled submit button, so
 * neither branch matched a real tab stop:
 *
 *   · Tab off the last enabled control fell through to the browser, which
 *     skipped the disabled button and left the dialog entirely.
 *   · Shift+Tab off the first called `.focus()` on a disabled element, which
 *     does nothing at all, so backwards tabbing was dead.
 *
 * Both tests below fail against that selector and pass against this one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The same wiring the real dialogs use: a listener on `document`, not a React
 * `onKeyDown`. The distinction matters — userEvent dispatches a real keydown
 * and decides whether to move focus from `defaultPrevented` on the NATIVE
 * event, so a trap tested through a synthetic handler would pass while the
 * shipped one leaked.
 */
function Dialog({ submitDisabled }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKeyDown = (e) => trapTab(e, ref.current);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={ref}>
      <input aria-label="Their email" />
      <button type="button">Cancel</button>
      <button type="submit" disabled={submitDisabled}>Continue</button>
    </div>
  );
}

const namesIn = (root) => focusablesIn(root).map(
  (el) => el.getAttribute('aria-label') || el.textContent,
);

describe('focusablesIn', () => {
  test('leaves out a disabled control, so it is never the trap boundary', () => {
    const { container } = render(<Dialog submitDisabled />);
    expect(namesIn(container)).toEqual(['Their email', 'Cancel']);
  });

  test('includes the submit button once it is enabled', () => {
    const { container } = render(<Dialog submitDisabled={false} />);
    expect(namesIn(container)).toEqual(['Their email', 'Cancel', 'Continue']);
  });
});

describe('trapTab', () => {
  test('Tab off the last ENABLED control wraps to the first, rather than leaving', async () => {
    const user = userEvent.setup();
    render(<Dialog submitDisabled />);

    const cancel = screen.getByText('Cancel');
    cancel.focus();
    expect(document.activeElement).toBe(cancel);

    // Cancel is the last control that can take focus; the disabled submit
    // after it is not. Without the fix nothing matched and focus escaped.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Their email'));
  });

  test('Shift+Tab off the first control reaches a real tab stop, not a disabled one', async () => {
    const user = userEvent.setup();
    render(<Dialog submitDisabled />);

    const email = screen.getByLabelText('Their email');
    email.focus();

    await user.tab({ shift: true });
    // The old code called .focus() on the disabled submit, which is a no-op —
    // so focus stayed on the email field and Shift+Tab did nothing.
    expect(document.activeElement).toBe(screen.getByText('Cancel'));
  });
});
