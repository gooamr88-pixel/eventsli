import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The web gate's session (2026-11-20). The door token is an httpOnly cookie
 * the API sets; this page never holds it, and localStorage keeps only who the
 * tablet is. A session saved by the version that kept the token is dropped.
 */

const KEY = 'eventsli.gate.device';
let calls;

function answer(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

async function fresh() {
  vi.resetModules();
  return import('../src/app/gate/gateSession');
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/scan/login')) {
      return answer({ device: { id: 'dev-1', label: 'Main door', eventId: 'ev-1' }, session: 'cookie', expiresAt: '2026-11-27T10:00:00.000Z', pinNeedsReset: true });
    }
    return answer({ ok: true });
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the web gate keeps no token', () => {
  test('signing in asks for the cookie, and stores who the tablet is, never a token', async () => {
    const { signIn, readSession } = await fresh();
    await signIn({ deviceId: ' dev-1 ', pin: '914273' });

    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({ deviceId: 'dev-1', pin: '914273', session: 'cookie' });
    expect(calls[0].init.credentials).toBe('include');

    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(stored).not.toHaveProperty('token');
    expect(stored).toMatchObject({ deviceId: 'dev-1', label: 'Main door', eventId: 'ev-1', pinNeedsReset: true });
    expect(readSession()).not.toHaveProperty('token');
  });

  test('every gate request sends the cookie and the gate header, and no Bearer', async () => {
    const { gatePost } = await fresh();
    await gatePost('/scan/verify', { qr: 'a.b.c' });
    const { init } = calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Eventsli-Gate']).toBe('1');
    expect(init.headers.Authorization).toBeUndefined();
  });

  test('a session saved with a token by the older version is dropped: the tablet signs in once more', async () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'old.jwt.token', deviceId: 'dev-1', eventId: 'ev-1' }));
    const { readSession } = await fresh();
    expect(readSession()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  test('a token passed to saveSession is still never stored', async () => {
    const { saveSession } = await fresh();
    saveSession({ token: 'x.y.z', deviceId: 'd', signedInAt: 'now' });
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ deviceId: 'd', signedInAt: 'now' });
  });

  test('signing out asks the API to clear the cookie, and forgets the tablet even offline', async () => {
    const { saveSession, signOutGate, readSession } = await fresh();
    saveSession({ deviceId: 'd', signedInAt: 'now' });
    await signOutGate();
    expect(calls[0].url).toMatch(/\/scan\/logout$/);
    expect(readSession()).toBeNull();

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    saveSession({ deviceId: 'd', signedInAt: 'now' });
    await signOutGate();
    expect(readSession()).toBeNull();
  });
});
