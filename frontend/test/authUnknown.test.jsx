import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * REGRESSION — "the Super Admin access is there, then it is gone".
 *
 * `useAuth` stored EVERY failure of `/auth/me` as "signed out" — a 503 from a
 * database blip, a 429, a timeout — and never asked again until a full reload.
 * So the admin console told a super admin it was "for platform staff", and the
 * admin card on their dashboard disappeared, until they refreshed.
 *
 * Only a 401 (or 403, a suspended account) means signed out. Anything else is
 * UNKNOWN: keep the last known user, ask again, and never refuse on it.
 */
const get = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({
  get: (...args) => get(...args),
  post: vi.fn(async () => ({})),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/overview',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The default lets this file load against a build that predates the helper.
const { useAuth, refreshAuth, resetAuthForTests = () => {} } = await import('../src/app/hooks/useAuth');
const { default: AdminLayout } = await import('../src/app/admin/layout');

const SUPER = {
  id: 'u1', email: 'owner@example.test', role: 'super_admin', accountTypes: ['buyer'],
  isOrganizer: false, isAdmin: true, isSuperAdmin: true,
};
const failure = (status, code) => Object.assign(new Error(code), { status, code });

function Probe() {
  const { user, loading, signedIn, unknown } = useAuth();
  return (
    <p data-testid="probe">
      {JSON.stringify({ role: user?.role || null, loading, signedIn, unknown })}
    </p>
  );
}
const probe = () => JSON.parse(screen.getByTestId('probe').textContent);

beforeEach(() => {
  vi.useFakeTimers();
  resetAuthForTests();
  get.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('who is signed in, when the API cannot say', () => {
  test('a 503 is not "signed out" — and the next attempt restores the super admin', async () => {
    get.mockRejectedValueOnce(failure(503, 'SESSION_CHECK_FAILED')).mockResolvedValue(SUPER);
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // The old behaviour was { loading: false, signedIn: false }: a decided "no".
    expect(probe()).toEqual({ role: null, loading: true, signedIn: false, unknown: true });

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe()).toEqual({ role: 'super_admin', loading: false, signedIn: true, unknown: false });
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('a network failure is unknown too', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('offline'), { name: 'NetworkError', status: 0 }))
      .mockResolvedValue(SUPER);
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(probe().unknown).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe().signedIn).toBe(true);
  });

  test('a 401 IS signed out, and is not asked again', async () => {
    get.mockRejectedValue(failure(401, 'UNAUTHENTICATED'));
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(probe()).toEqual({ role: null, loading: false, signedIn: false, unknown: false });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('a known user survives a failed re-check', async () => {
    get.mockResolvedValueOnce(SUPER).mockRejectedValue(failure(500, 'INTERNAL_ERROR'));
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(probe().role).toBe('super_admin');

    await act(async () => { await refreshAuth(); });
    expect(probe()).toEqual({ role: 'super_admin', loading: false, signedIn: true, unknown: false });
  });

  test('retries stop after the backoff, and focus asks again', async () => {
    get.mockRejectedValue(failure(503, 'SESSION_CHECK_FAILED'));
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(get).toHaveBeenCalledTimes(4);            // the first ask + three retries

    get.mockResolvedValue(SUPER);
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
    expect(probe().role).toBe('super_admin');
  });
});

describe('the admin console', () => {
  test('REGRESSION: an unknown answer offers a retry, never the "not for you" refusal', async () => {
    get.mockRejectedValueOnce(failure(503, 'SESSION_CHECK_FAILED')).mockResolvedValue(SUPER);
    render(<AdminLayout><p>console body</p></AdminLayout>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.queryByText(/This area is for platform staff/i)).toBeNull();
    expect(screen.getByText(/could not confirm your access/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('console body')).toBeInTheDocument();
  });

  test('an ended session is told to sign in, not that the account is not staff', async () => {
    get.mockRejectedValue(failure(401, 'SESSION_REVOKED'));
    render(<AdminLayout><p>console body</p></AdminLayout>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText(/This area is for platform staff/i)).toBeNull();
    expect(screen.getByText(/Your session has ended/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login?reason=expired&next=%2Fadmin%2Foverview');
  });

  test('a signed-in non-admin is still refused', async () => {
    get.mockResolvedValue({ ...SUPER, role: 'attendee', isAdmin: false, isSuperAdmin: false });
    render(<AdminLayout><p>console body</p></AdminLayout>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/This area is for platform staff/i)).toBeInTheDocument();
    expect(screen.queryByText('console body')).toBeNull();
  });
});
