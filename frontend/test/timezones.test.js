import { describe, it, expect } from 'vitest';
import { TIME_ZONES, defaultTimeZone, zonesFor } from '../src/app/lib/timezones';

describe('timezones', () => {
  it('lists only zones this runtime can format in', () => {
    for (const [zone] of [...TIME_ZONES.CA, ...TIME_ZONES.US]) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)).not.toThrow();
    }
  });

  it('prefers the browser zone when it belongs to the country', () => {
    expect(defaultTimeZone('CA', 'America/Vancouver')).toBe('America/Vancouver');
    expect(defaultTimeZone('US', 'America/Chicago')).toBe('America/Chicago');
  });

  it('falls back to the most populous zone when the browser is elsewhere', () => {
    expect(defaultTimeZone('CA', 'Europe/London')).toBe('America/Toronto');
    expect(defaultTimeZone('US', 'America/Toronto')).toBe('America/New_York');
    expect(defaultTimeZone('US', null)).toBe('America/New_York');
  });

  it('treats an unknown country as Canada rather than returning nothing', () => {
    expect(zonesFor('XX')).toBe(TIME_ZONES.CA);
    expect(defaultTimeZone('XX', null)).toBe('America/Toronto');
  });
});
