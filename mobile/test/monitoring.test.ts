/**
 * What a crash report may carry (src/lib/monitoring.ts). The phone handles a
 * guest list; a crash report is not a way for it to leave.
 */
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl, startMonitoring, measureScan } from '../src/lib/monitoring';

const TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImsxIn0.eyJ0eXAiOiJ0aWNrZXQifQ.c2lnbmF0dXJl';

test('tokens and email addresses are replaced wherever they appear', () => {
  expect(scrubText(`Bearer ${TOKEN} for sara@example.com`)).toBe('Bearer [token] for [email]');
});

test('URLs lose their query string: the guest search carries names', () => {
  expect(scrubUrl('https://eventsli.com/api/v1/scan/attendees?q=Sara%20Ahmed&status=all')).toBe('https://eventsli.com/api/v1/scan/attendees');
  expect(scrubUrl(`https://eventsli.com/api/v1/tickets/qr/${TOKEN}.png`)).toBe('https://eventsli.com/api/v1/tickets/qr/[token].png');
});

test('an event: no user, no headers, no query, scrubbed messages, extra and breadcrumbs', () => {
  const event = scrubEvent({
    message: `Scan failed for ${TOKEN}`,
    user: { email: 'org@example.com' },
    request: { url: 'https://eventsli.com/api/v1/scan/manifest?cursor=abc', headers: { Authorization: `Bearer ${TOKEN}` }, cookies: 'x' },
    exception: { values: [{ value: 'ApiError: john.smith@example.com is not on the door team' }] },
    extra: { attendee: 'Sara Ahmed', note: `qr ${TOKEN}`, nested: { holder: 'John', ok: 1 } },
    breadcrumbs: [
      { category: 'console', message: 'Sara Ahmed admitted' },
      { category: 'fetch', data: { url: 'https://eventsli.com/api/v1/scan/attendees?q=sara', method: 'GET', status_code: 200 } },
    ],
  });
  expect(event.user).toBeUndefined();
  expect(event.request).toEqual({ url: 'https://eventsli.com/api/v1/scan/manifest' });
  expect(event.message).toBe('Scan failed for [token]');
  expect(event.exception?.values?.[0].value).toBe('ApiError: [email] is not on the door team');
  expect(event.extra).toEqual({ note: 'qr [token]', nested: { ok: 1 } });
  expect(event.breadcrumbs).toEqual([
    { category: 'fetch', data: { url: 'https://eventsli.com/api/v1/scan/attendees', method: 'GET', status_code: 200 } },
  ]);
});

test('console breadcrumbs are dropped entirely', () => {
  expect(scrubBreadcrumb({ category: 'console', message: 'anything' })).toBeNull();
});

test('with no DSN, nothing starts and a scan is simply run', async () => {
  expect(startMonitoring({ dsn: undefined })).toBe(false);
  await expect(measureScan(async () => 42, () => 'x')).resolves.toBe(42);
});
