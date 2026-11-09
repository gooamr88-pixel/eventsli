import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * "Sign in with Eventsli" — the website's consent step for the check-in app.
 *
 * The properties that matter: nothing is handed back without an explicit
 * Allow, a malformed request offers no button at all, the code goes back only
 * to the app's own scheme, and the app's `state` survives the round trip.
 */
const post = vi.fn();
let params = new URLSearchParams();

vi.mock('../src/app/utils/apiClient', () => ({
  post: (...args) => post(...args),
  get: vi.fn(),
}));
vi.mock('../src/app/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'organizer@example.test' }, loading: false, signedIn: true }),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app-auth',
}));

const { default: AppAuthorize } = await import('../src/app/(auth)/app-auth/AppAuthorize');

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const assign = vi.fn();

beforeEach(() => {
  post.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true, configurable: true });
});

describe('the check-in app consent page', () => {
  test('names the account, and hands nothing back until Allow is pressed', async () => {
    params = new URLSearchParams({
      code_challenge: CHALLENGE, code_challenge_method: 'S256',
      redirect_uri: 'eventsli-checkin://auth/callback', state: 'st-123',
    });
    post.mockResolvedValue({ code: 'one-time-code', expiresIn: 120 });
    render(<AppAuthorize />);

    expect(screen.getByText('organizer@example.test')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Allow and return to the app/ }));
    await waitFor(() => expect(assign).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith('/auth/app/authorize', {
      codeChallenge: CHALLENGE, redirectUri: 'eventsli-checkin://auth/callback',
    });
    const back = new URL(assign.mock.calls[0][0]);
    expect(back.protocol).toBe('eventsli-checkin:');
    expect(back.searchParams.get('code')).toBe('one-time-code');
    expect(back.searchParams.get('state')).toBe('st-123');
  });

  test('Cancel tells the app no, with its state', () => {
    params = new URLSearchParams({
      code_challenge: CHALLENGE, redirect_uri: 'eventsli-checkin://auth/callback', state: 'st-9',
    });
    render(<AppAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const back = new URL(assign.mock.calls[0][0]);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('st-9');
    expect(post).not.toHaveBeenCalled();
  });

  test('a request to send the code anywhere but the app offers no button', () => {
    params = new URLSearchParams({ code_challenge: CHALLENGE, redirect_uri: 'https://evil.example/cb' });
    render(<AppAuthorize />);
    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull();
    expect(screen.getByText(/not complete/)).toBeTruthy();
  });

  test('a missing or "plain" challenge offers no button', () => {
    params = new URLSearchParams({ redirect_uri: 'eventsli-checkin://auth/callback' });
    const { unmount } = render(<AppAuthorize />);
    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull();
    unmount();

    params = new URLSearchParams({
      code_challenge: CHALLENGE, code_challenge_method: 'plain', redirect_uri: 'eventsli-checkin://auth/callback',
    });
    render(<AppAuthorize />);
    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull();
  });
});
