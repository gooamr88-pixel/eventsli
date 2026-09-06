import { describe, test, expect } from 'vitest';
import { toIso } from '../src/app/organizer/events/new/NewEventForm';

/**
 * `datetime-local` has no timezone, and that is the whole problem.
 *
 * The input yields "2026-09-05T20:00". `new Date()` on that reads it in the
 * BROWSER's zone — so an organizer in Vancouver scheduling a Toronto show at
 * 8pm creates it at 11pm, and nothing anywhere reports an error. The event page
 * then renders the wrong time in the correct timezone, which is the most
 * convincing possible way to be wrong.
 */
describe('toIso — the event time is anchored to the EVENT timezone', () => {
  test('8pm in Toronto is 8pm in Toronto, whatever the browser thinks', () => {
    const iso = toIso('2026-09-05T20:00', 'America/Toronto');
    // September — EDT, UTC−4.
    expect(iso).toBe('2026-09-06T00:00:00.000Z');

    const backInToronto = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto', hour: 'numeric', hour12: false,
    }).format(new Date(iso));
    expect(backInToronto).toBe('20');
  });

  test('daylight saving is handled, because the offset is computed per instant', () => {
    // A fixed −5 for Toronto would put the September show an hour out. January
    // is EST (−5), July is EDT (−4), and the same code has to give both.
    expect(toIso('2026-01-15T20:00', 'America/Toronto')).toBe('2026-01-16T01:00:00.000Z');
    expect(toIso('2026-07-15T20:00', 'America/Toronto')).toBe('2026-07-16T00:00:00.000Z');
  });

  test('the same wall clock in different zones gives different instants', () => {
    const toronto = toIso('2026-09-05T20:00', 'America/Toronto');
    const vancouver = toIso('2026-09-05T20:00', 'America/Vancouver');
    expect(toronto).not.toBe(vancouver);
    // Vancouver is three hours behind, so its 8pm happens three hours later.
    expect(new Date(vancouver) - new Date(toronto)).toBe(3 * 60 * 60 * 1000);
  });

  test('a zone with a half-hour offset survives', () => {
    // Newfoundland is UTC−2:30 in September. A naive hours-only conversion
    // silently drops the thirty minutes.
    const iso = toIso('2026-09-05T20:00', 'America/St_Johns');
    expect(iso).toBe('2026-09-05T22:30:00.000Z');
  });

  test('an empty or malformed value is passed through, not turned into NaN', () => {
    // A half-typed form must not produce "Invalid Date" in a request body.
    expect(toIso('', 'America/Toronto')).toBe('');
    expect(toIso(undefined, 'America/Toronto')).toBe(undefined);
    expect(toIso('not-a-date', 'America/Toronto')).toBe('not-a-date');
  });

  test('round-trips: what the organizer typed is what a buyer is shown', () => {
    // The property that actually matters, asserted end to end for a handful of
    // zones the platform sells into.
    for (const [zone, local] of [
      ['America/Toronto', '2026-11-20T19:30'],
      ['America/Vancouver', '2026-03-14T09:15'],
      ['America/New_York', '2026-06-01T23:45'],
      ['America/Chicago', '2026-12-31T00:05'],
    ]) {
      const shown = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(toIso(local, zone)));

      const [date, time] = local.split('T');
      expect(shown, `${zone} ${local}`).toBe(`${date}, ${time}`);
    }
  });
});
