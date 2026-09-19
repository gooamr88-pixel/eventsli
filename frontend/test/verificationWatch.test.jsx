import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let query = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh }),
  useSearchParams: () => query,
}));
vi.mock('../src/app/utils/apiClient', () => ({ post: vi.fn() }));
vi.mock('../src/app/hooks/useAuth', () => ({ setAuthUser: vi.fn() }));

import { post } from '../src/app/utils/apiClient';
import { setAuthUser } from '../src/app/hooks/useAuth';
import VerifyEmailForm from '../src/app/(auth)/verify-email/VerifyEmailForm';
import { rememberWatchToken, forgetWatchToken } from '../src/app/(auth)/verify-email/useVerificationWatch';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESSION — "I verified on my phone and the laptop never noticed."
 *
 * Signing up on a laptop and opening the email on a phone is the ordinary case,
 * not an edge one. The phone activates the account and is signed in; this
 * screen had no session to check and no token from the email, so it sat on
 * "Check your inbox · Open the email · Tap Activate" for as long as the tab
 * stayed open — instructing somebody to do a thing they had already done.
 *
 * The watch token is handed to the tab that submitted the form, never emailed,
 * and answers "not yet" until somebody with the INBOX confirms the account.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the waiting screen notices an activation on another device', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    post.mockReset();
    setAuthUser.mockReset();
    push.mockReset();
    replace.mockReset();
    sessionStorage.clear();
    query = new URLSearchParams({ email: 'ava@example.test', sent: '1' });
  });

  afterEach(() => { vi.useRealTimers(); });

  test('it waits, then reports the activation and goes where the API says', async () => {
    rememberWatchToken('watch_abc');
    // Not yet, not yet, then yes — the shape of a real wait.
    post
      .mockResolvedValueOnce({ verified: false })
      .mockResolvedValueOnce({
        verified: true,
        signedIn: true,
        user: { id: 'u1', email: 'ava@example.test', role: 'attendee' },
        next: '/organizer',
      });

    render(<VerifyEmailForm />);

    // Until it hears otherwise, the instruction stands.
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

    // The screen SAYS what happened rather than jumping silently.
    await waitFor(() => expect(screen.getByText(/your account is active/i)).toBeInTheDocument());
    expect(screen.getByText(/another device/i)).toBeInTheDocument();

    expect(post).toHaveBeenCalledWith(
      '/auth/verification-status',
      { watchToken: 'watch_abc' },
      expect.objectContaining({ noRedirect: true }),
    );
    expect(setAuthUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/organizer'));
    // Spent: a second tab must not be able to redeem it again.
    expect(sessionStorage.getItem('eventsli.verifyWatch')).toBeNull();
  });

  test('an explicit ?next= still wins over the API default', async () => {
    query = new URLSearchParams({ email: 'ava@example.test', next: '/checkout/abc' });
    rememberWatchToken('watch_abc');
    post.mockResolvedValue({
      verified: true, signedIn: true, user: { id: 'u1' }, next: '/organizer',
    });

    render(<VerifyEmailForm />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/checkout/abc'));
  });

  test('confirmed but blocked goes to sign-in, where the block is explained', async () => {
    rememberWatchToken('watch_abc');
    post.mockResolvedValue({ verified: true, signedIn: false });

    render(<VerifyEmailForm />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('/login')));
    expect(setAuthUser).not.toHaveBeenCalled();
  });

  /**
   * Reaching this page through "resend" alone hands out no token — that
   * endpoint answers identically for every address, so minting one there would
   * give anybody a watcher on a stranger's account. The page still works by
   * hand; it simply does not poll.
   */
  test('with no token it never asks, and the manual path is untouched', async () => {
    forgetWatchToken();
    render(<VerifyEmailForm />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
  });
});
