import { ApiError, NetworkError, PRODUCTION_API_URL, request, resolveApiUrl, withQuery } from '../src/api/client';

/**
 * The client's two promises: a hold's token and the session travel TOGETHER
 * without one masking the other (the API reads x-access-token first for a
 * hold — accessTokens.reservationTokenFrom), and a store build can never be
 * pointed at plain HTTP.
 */
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function answer(status: number, body: unknown) {
  const fn = jest.fn(async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

it('sends the session as Bearer and the hold as x-access-token', async () => {
  const fetchMock = answer(200, { success: true, data: { ok: 1 } });
  await request('/public/reservations/r/checkout', { method: 'POST', body: { a: 1 }, token: 'SESSION', reservationToken: 'HOLD' });
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  expect(headers.Authorization).toBe('Bearer SESSION');
  expect(headers['x-access-token']).toBe('HOLD');
  expect(headers['Content-Type']).toBe('application/json');
});

it('turns a refusal into an ApiError carrying the server\'s code', async () => {
  answer(409, { success: false, error: 'SEAT_UNAVAILABLE', message: 'That seat was just taken.' });
  await expect(request('/x')).rejects.toMatchObject({ code: 'SEAT_UNAVAILABLE', status: 409, message: 'That seat was just taken.' });
  answer(502, null);
  await expect(request('/x')).rejects.toBeInstanceOf(ApiError);
});

it('tells "no signal" apart from "no"', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
  await expect(request('/x')).rejects.toBeInstanceOf(NetworkError);
});

it('never lets a store build talk plain HTTP', () => {
  expect(resolveApiUrl('http://192.168.1.5:5000/api/v1', false)).toBe(PRODUCTION_API_URL);
  expect(resolveApiUrl('http://192.168.1.5:5000/api/v1', true)).toBe('http://192.168.1.5:5000/api/v1');
  expect(resolveApiUrl(undefined, false)).toBe(PRODUCTION_API_URL);
});

it('drops empty query values and encodes the rest', () => {
  expect(withQuery('/e', { q: 'rock & roll', city: '', page: 2, x: null })).toBe('/e?q=rock%20%26%20roll&page=2');
});
