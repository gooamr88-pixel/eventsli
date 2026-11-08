import crypto from 'node:crypto';

import { base64ToBase64Url, bytesToBase64Url, bytesToHex, decodeBase64Url } from '../src/lib/base64';
import { ago, eventWhen, hoursUntil } from '../src/lib/format';
import { compareVersions, needsUpdate } from '../src/lib/version';

describe('base64url', () => {
  test('matches Node for every length, and round-trips', () => {
    for (let n = 0; n < 40; n += 1) {
      const bytes = crypto.randomBytes(n);
      const ours = bytesToBase64Url(new Uint8Array(bytes));
      expect(ours).toBe(bytes.toString('base64url'));
      expect(decodeBase64Url(ours)).toBe(bytes.toString('latin1'));
    }
  });

  test('a PKCE challenge built our way matches the server’s S256', () => {
    const verifier = bytesToBase64Url(new Uint8Array(crypto.randomBytes(32)));
    expect(verifier).toHaveLength(43);
    const padded = crypto.createHash('sha256').update(verifier).digest('base64');
    expect(base64ToBase64Url(padded)).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
  });

  test('malformed input is refused, not guessed at', () => {
    expect(decodeBase64Url('a')).toBeNull();
    expect(decodeBase64Url('ab$c')).toBeNull();
  });

  test('hex for the database key', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});

describe('versions', () => {
  test('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(needsUpdate('1.0.0', '1.0.1')).toBe(true);
    expect(needsUpdate('2.0.0', '1.9.9')).toBe(false);
    // Unknown on either side never blocks a door.
    expect(needsUpdate(null, '9.9.9')).toBe(false);
    expect(needsUpdate('1.0.0', undefined)).toBe(false);
  });
});

describe('times', () => {
  test('an event is shown in its own time zone', () => {
    // 23:00 UTC is 6 PM in Toronto (EST, November).
    expect(eventWhen('2026-11-15T23:00:00Z', 'America/Toronto')).toMatch(/Nov 15, 2026 • 6:00\sPM/);
  });

  test('"last updated" reads like a person would say it', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(ago('2026-11-08T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-11-08T11:55:00Z', now)).toBe('5 min ago');
    expect(ago('2026-11-08T09:00:00Z', now)).toBe('3 h ago');
    expect(hoursUntil('2026-11-08T20:30:00Z', now)).toBe(8);
  });
});
