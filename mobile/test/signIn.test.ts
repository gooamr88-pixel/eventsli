import { buildQuery, parseQuery } from '../src/lib/query';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-device', () => ({ deviceName: "Sara's Pixel", modelName: 'Pixel 8' }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({}));
jest.mock('../src/api/endpoints', () => ({
  REDIRECT_URI: 'eventsli-checkin://auth/callback',
  exchangeCode: jest.fn(async () => ({ token: 't', expiresAt: '2030-01-01T00:00:00Z', user: { email: 'x@y.z' } })),
}));

// eslint-disable-next-line import/first
import { exchangeCode } from '../src/api/endpoints';
// eslint-disable-next-line import/first
import { finishSignIn, SignInCancelled } from '../src/auth/pkce';

describe('query strings, the same on a phone as here', () => {
  test('a custom-scheme callback gives up its code and state, decoded', () => {
    expect(parseQuery('eventsli-checkin://auth/callback?code=ab_c-1&state=xy%2Fz')).toEqual({ code: 'ab_c-1', state: 'xy/z' });
    expect(parseQuery('eventsli-checkin://auth/callback?error=access_denied&state=s#frag')).toEqual({ error: 'access_denied', state: 's' });
    expect(parseQuery('eventsli-checkin://auth/callback')).toEqual({});
    expect(parseQuery('x://y?a=1&a=2&bad=%E0%A4%A')).toEqual({ a: '1' });
  });

  test('building and parsing round-trip', () => {
    const q = buildQuery({ redirect_uri: 'eventsli-checkin://auth/callback', state: 'a b&c', empty: '', none: null });
    expect(parseQuery(`https://x/app-auth?${q}`)).toEqual({ redirect_uri: 'eventsli-checkin://auth/callback', state: 'a b&c' });
  });
});

describe('finishing "Sign in with Eventsli"', () => {
  beforeEach(() => (exchangeCode as jest.Mock).mockClear());

  test('the code is traded with the verifier when the state matches', async () => {
    await finishSignIn('eventsli-checkin://auth/callback?code=CODE&state=S1', 'S1', 'VERIFIER');
    // The model only, never the phone's own (often personal) name.
    expect(exchangeCode).toHaveBeenCalledWith('CODE', 'VERIFIER', 'Pixel 8');
  });

  test('a callback for a request this app did not make is never exchanged', async () => {
    await expect(finishSignIn('eventsli-checkin://auth/callback?code=CODE&state=OTHER', 'S1', 'V')).rejects.toThrow(/did not come from this app/);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  test('Cancel on the website is a cancel, not an error', async () => {
    await expect(finishSignIn('eventsli-checkin://auth/callback?error=access_denied&state=S1', 'S1', 'V')).rejects.toBeInstanceOf(SignInCancelled);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});
