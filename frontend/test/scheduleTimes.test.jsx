import { describe, test, expect } from 'vitest';
import { localToInstant, instantToLocal } from '../src/app/organizer/events/[id]/content/ScheduleEditor';

/**
 * The schedule editor's two conversions, between an instant and the wall-clock
 * time at the venue.
 *
 * Pinned because they CRASHED. The editor measured the zone offset by
 * formatting a date with `toLocaleString('en-CA')` and parsing the text back;
 * V8 writes that locale as "2026-11-01, 12:30:00 p.m.", which parses to NaN, so
 * `toISOString()` threw and the whole Page & branding screen fell to its error
 * boundary for any event with one schedule row. Every case below with an
 * afternoon time is a case that used to throw.
 */
describe('schedule times', () => {
  test('an afternoon instant reads as the venue clock, without throwing', () => {
    // 17:30 UTC on 1 Nov 2026 is 12:30 in Toronto (EST, after the change).
    expect(instantToLocal('2026-11-01T17:30:00.000Z', 'America/Toronto')).toBe('2026-11-01T12:30');
    // Summer time: 00:00 UTC is 8pm the evening before.
    expect(instantToLocal('2026-07-02T00:00:00.000Z', 'America/Toronto')).toBe('2026-07-01T20:00');
  });

  test('a typed time is anchored to the venue, not to the browser', () => {
    expect(localToInstant('2026-11-01T12:30', 'America/Toronto')).toBe('2026-11-01T17:30:00.000Z');
    expect(localToInstant('2026-07-01T20:00', 'America/Vancouver')).toBe('2026-07-02T03:00:00.000Z');
  });

  test('round trip moves nothing, including on the day the clocks change', () => {
    for (const [iso, zone] of [
      ['2026-11-01T17:30:00.000Z', 'America/Toronto'],
      ['2026-03-08T19:45:00.000Z', 'America/Chicago'],
      ['2026-12-31T23:30:00.000Z', 'America/Denver'],
    ]) {
      expect(localToInstant(instantToLocal(iso, zone), zone)).toBe(iso);
    }
  });

  test('empty is "not set", never a crash or a malformed string', () => {
    expect(localToInstant('', 'America/Toronto')).toBeNull();
    expect(localToInstant('2026-11-0', 'America/Toronto')).toBeNull();
    expect(instantToLocal(null, 'America/Toronto')).toBe('');
    expect(instantToLocal('not a date', 'America/Toronto')).toBe('');
  });
});
