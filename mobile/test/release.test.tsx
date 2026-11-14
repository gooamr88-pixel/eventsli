/**
 * Release hardening (2026-11-14 App Store audit):
 *   • a store build talks to the API and the website over HTTPS only,
 *   • a request's timeout covers the body, not just the headers,
 *   • a screen that throws shows a way back instead of a blank screen,
 *   • a locked gate says why.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-device', () => ({ deviceName: null, modelName: null }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({}));

// eslint-disable-next-line import/first
import { NetworkError, PRODUCTION_API_URL, request, resolveApiUrl } from '../src/api/client';
// eslint-disable-next-line import/first
import { siteUrl } from '../src/auth/pkce';
// eslint-disable-next-line import/first
import { describeScan, lockedNote } from '../src/gate/outcomes';
// eslint-disable-next-line import/first
import { reportError } from '../src/lib/monitoring';

describe('the API address', () => {
  test('a development build may use a laptop over plain HTTP', () => {
    expect(resolveApiUrl('http://192.168.1.6:5000/api/v1/', true)).toBe('http://192.168.1.6:5000/api/v1');
  });

  test('a store build never does: it falls back to production', () => {
    expect(resolveApiUrl('http://192.168.1.6:5000/api/v1', false)).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl(undefined, false)).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl('', false)).toBe(PRODUCTION_API_URL);
  });

  test('an HTTPS address is kept as configured', () => {
    expect(resolveApiUrl('https://staging.eventsli.com/api/v1/', false)).toBe('https://staging.eventsli.com/api/v1');
  });

  test('the website follows the same rule', () => {
    expect(siteUrl('http://192.168.1.6:3000', false)).toBe(PRODUCTION_API_URL.replace(/\/api\/v1$/, ''));
    expect(siteUrl('http://192.168.1.6:3000/', true)).toBe('http://192.168.1.6:3000');
    expect(siteUrl('https://eventsli.com/', false)).toBe('https://eventsli.com');
  });
});

describe('a request that stalls', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('headers then silence is a timeout, not a hang', async () => {
    // Answers at once, then never finishes the body.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    })) as unknown as typeof fetch;
    const started = Date.now();
    await expect(request('/scan/ping', { timeoutMs: 50 })).rejects.toBeInstanceOf(NetworkError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a normal answer still reads as the envelope', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { ok: 1 } }),
    })) as unknown as typeof fetch;
    await expect(request('/x')).resolves.toEqual({ data: { ok: 1 }, pagination: undefined });
  });

  test('a proxy error page is a server error with its status', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' })) as unknown as typeof fetch;
    await expect(request('/x')).rejects.toMatchObject({ status: 502, code: 'SERVER_ERROR' });
  });
});

describe('a locked gate', () => {
  test('says why when the server said', () => {
    expect(describeScan('scanner_locked', 'event_cancelled').note).toMatch(/cancelled/);
    expect(lockedNote('commission_overdue')).toMatch(/commission invoice/);
  });

  test('falls back to a neutral note for a reason it does not know', () => {
    expect(describeScan('scanner_locked', 'something_new').note).toMatch(/Call the organizer/);
    expect(lockedNote('something_new')).toBeNull();
    expect(lockedNote(null)).toBeNull();
  });
});

describe('the root error boundary', () => {
  test('reporting with crash reporting off is a no-op', () => {
    expect(() => reportError(new Error('x'))).not.toThrow();
  });

  test('shows a way back, and never the error text', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ErrorBoundary } = require('../src/app/_layout') as typeof import('../src/app/_layout');
    const retry = jest.fn(async () => undefined);
    await render(<ErrorBoundary error={new Error('guest Sara Ali eyJx.y.z')} retry={retry} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText(/Sara Ali/)).toBeNull();
    await fireEvent.press(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});
