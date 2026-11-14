import crypto from 'node:crypto';

import { base64ToBase64Url, bytesToBase64Url, bytesToHex, decodeBase64Url } from '../src/lib/base64';
import { ago, duration, eventPhase, eventWhen, hoursUntil, initials, percent } from '../src/lib/format';
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

  test('a length of time is rounded the way it is read', () => {
    expect(duration(30_000)).toBe('1 min');
    expect(duration(45 * 60_000)).toBe('45 min');
    expect(duration(150 * 60_000)).toBe('2 h 30 min');
    expect(duration(5 * 3600e3 + 20 * 60_000)).toBe('5 h');
    expect(duration(24 * 3600e3)).toBe('1 day');
    expect(duration(3 * 24 * 3600e3)).toBe('3 days');
  });

  test('an event’s status chip follows the clock', () => {
    const start = '2026-11-08T18:00:00Z';
    const end = '2026-11-08T23:00:00Z';
    expect(eventPhase(start, end, Date.parse('2026-11-05T18:00:00Z'))).toEqual({ phase: 'upcoming', label: 'In 3 days' });
    expect(eventPhase(start, end, Date.parse('2026-11-08T16:00:00Z'))).toEqual({ phase: 'soon', label: 'Starts in 2 h' });
    expect(eventPhase(start, end, Date.parse('2026-11-08T19:00:00Z'))).toEqual({ phase: 'live', label: 'Live now' });
    expect(eventPhase(start, end, Date.parse('2026-11-08T23:00:00Z'))).toEqual({ phase: 'ended', label: 'Finished' });
    // No end given: four hours after the start.
    expect(eventPhase(start, null, Date.parse('2026-11-08T21:59:00Z')).phase).toBe('live');
  });
});

describe('people and shares', () => {
  test('initials for an avatar', () => {
    expect(initials('Sara Ahmed')).toBe('SA');
    expect(initials('  chloé  roy ')).toBe('CR');
    expect(initials('Michael J. Brown')).toBe('MB');
    expect(initials('Zoë')).toBe('Z');
    expect(initials(null)).toBe('');
    expect(initials(' - ')).toBe('');
  });

  test('a percent never passes 100, and nothing of nothing is 0', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 4)).toBe(100);
    expect(percent(0, 0)).toBe(0);
  });
});
