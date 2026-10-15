// @vitest-environment node
import { describe, test, expect, beforeAll } from 'vitest';

/**
 * REGRESSION — signed in and signed out at once, on `www.`.
 *
 * The API sets the session cookie on `eventsli.com` with no Domain attribute.
 * On `www.eventsli.com` the client's `/auth/me` (sent to the apex) saw the
 * session and showed the admin card, while proxy.ts — running on `www.` —
 * saw no cookie and bounced /admin to /login. The fix sends the `www` twin of
 * the canonical host to the canonical host before anything else runs.
 *
 * These call the real `proxy` with real NextRequests.
 */
let proxy; let NextRequest;

// 60s, not the 10s hook default: the first import of next/server loads a large
// module graph, and on a busy machine that alone has taken longer than ten.
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://eventsli.com';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  ({ NextRequest } = await import('next/server'));
  ({ proxy } = await import('../src/proxy'));
}, 60_000);

const request = (url, { host, cookie } = {}) => new NextRequest(url, {
  headers: {
    host: host || new URL(url).host,
    ...(cookie ? { cookie } : {}),
  },
});

describe('the canonical host', () => {
  test('REGRESSION: www is sent to the apex, path and query kept, method-preserving', () => {
    const res = proxy(request('https://www.eventsli.com/admin/overview?tab=approvals'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://eventsli.com/admin/overview?tab=approvals');
  });

  test('it runs before the auth rules — a www visitor is not bounced to a www /login', () => {
    const res = proxy(request('https://www.eventsli.com/organizer'));
    expect(res.headers.get('location')).toBe('https://eventsli.com/organizer');
  });

  test('a Stripe return to www lands on the apex, where the cookie is', () => {
    const res = proxy(request('https://www.eventsli.com/checkout/success?session_id=cs_test_1'));
    expect(res.headers.get('location')).toBe('https://eventsli.com/checkout/success?session_id=cs_test_1');
  });

  test('the canonical host itself passes straight through', () => {
    const res = proxy(request('https://eventsli.com/events'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  test('a signed-in apex request to /admin is not redirected', () => {
    const res = proxy(request('https://eventsli.com/admin', { cookie: 'eventsli_session=abc' }));
    expect(res.headers.get('location')).toBeNull();
  });

  test('any OTHER host is left alone — a forged Host header is not an open redirect', () => {
    for (const host of ['evil.example', 'www.evil.example', 'eventsli.com.evil.example', 'wwweventsli.com']) {
      const res = proxy(request(`https://${host}/events`, { host }));
      const location = res.headers.get('location');
      expect(location === null || !location.startsWith('https://eventsli.com'), host).toBe(true);
    }
  });

  test('localhost in development is untouched', () => {
    const res = proxy(request('http://localhost:3000/events', { host: 'localhost:3000' }));
    expect(res.headers.get('location')).toBeNull();
  });
});
