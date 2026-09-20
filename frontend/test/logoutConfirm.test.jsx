import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Signing out is now a question, and these are the properties that make the
 * question worth asking.
 *
 * `signOut` is mocked because the real one ends in `window.location.assign` —
 * jsdom cannot navigate, and the point under test is WHEN it is called, not
 * what it does.
 */
const signOut = vi.fn(() => new Promise(() => {}));
vi.mock('../src/app/hooks/useAuth', () => ({
  signOut: (...args) => signOut(...args),
  useAuth: () => ({ user: null, loading: false, signedIn: false }),
  setAuthUser: () => {},
}));

// A static import is fine: `vi.mock` is hoisted above it by vitest.
import LogoutButton, { LogoutConfirmDialog } from '../src/app/components/auth/LogoutConfirm';

beforeEach(() => {
  signOut.mockReset();
  // A promise that never settles: the real one never resolves either, because
  // the document is navigating away. That is what keeps the busy state up.
  signOut.mockImplementation(() => new Promise(() => {}));
});

describe('LogoutButton', () => {
  test('asks before it signs anybody out', async () => {
    const user = userEvent.setup();
    render(<LogoutButton className="es-btn">Sign out</LogoutButton>);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('heading', { name: 'Sign out?' })).toBeInTheDocument();
    // The whole point: the click opened a question, it did not end the session.
    expect(signOut).not.toHaveBeenCalled();
  });

  test('Cancel closes it and nobody is signed out', async () => {
    const user = userEvent.setup();
    render(<LogoutButton>Sign out</LogoutButton>);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'Sign out?' })).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('confirming runs the existing sign-out, with the destination given', async () => {
    const user = userEvent.setup();
    render(<LogoutButton next="/somewhere">Sign out</LogoutButton>);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    // The dialog's own button, not the one that opened it.
    const dialog = screen.getByRole('heading', { name: 'Sign out?' }).closest('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith('/somewhere');
  });

  test('a second click cannot spend a second logout request', async () => {
    const user = userEvent.setup();
    render(<LogoutButton>Sign out</LogoutButton>);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('heading', { name: 'Sign out?' }).closest('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Sign out' });

    await user.click(confirm);
    // Disabled the moment it is busy, and guarded in the handler besides — the
    // button being disabled is a UI fact, the guard is the actual protection.
    await user.click(confirm).catch(() => {});

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('it says it is working, in words rather than only a spinner', async () => {
    const user = userEvent.setup();
    render(<LogoutButton>Sign out</LogoutButton>);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('heading', { name: 'Sign out?' }).closest('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    const busy = within(dialog).getByRole('button', { name: 'Signing out…' });
    expect(busy).toBeDisabled();
    // `aria-busy` plus real text: a spinner alone tells a screen reader nothing.
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

describe('the dialog itself', () => {
  test('is labelled and described for a screen reader', () => {
    render(<LogoutConfirmDialog onCancel={() => {}} />);

    const dialog = document.querySelector('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    const describedId = dialog.getAttribute('aria-describedby');

    expect(document.getElementById(labelId)).toHaveTextContent('Sign out?');
    expect(document.getElementById(describedId)).toHaveTextContent(/sign in again/i);
  });

  test('a failure hands the decision back rather than claiming success', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => Promise.reject(new Error('network')));
    render(<LogoutConfirmDialog onConfirm={onConfirm} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not sign you out/i);
    // Offered again, not left spinning.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  test('a caller can replace the action and the words without a second dialog', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise(() => {}));
    render(
      <LogoutConfirmDialog
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
        busyLabel="Ending sessions…"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Sign out everywhere?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    // The replacement ran and the default did not.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ending sessions…' })).toBeDisabled();
  });
});

