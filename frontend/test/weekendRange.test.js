import { describe, test, expect } from 'vitest';
import { weekendRange } from '../src/app/events/QuickFilters';

/**
 * "This weekend", as a date range.
 *
 * Fiddly enough to be worth pinning: the whole filter is one modular-arithmetic
 * expression, and every way of getting it wrong produces a plausible-looking
 * range that quietly shows the wrong events. The case that matters most is
 * somebody opening the site ON the weekend — if the window jumps forward to
 * NEXT Friday, the filter hides the very events they are trying to find, on the
 * day they are looking for them.
 *
 * Local dates throughout: the claim is about the reader's calendar, not about
 * any event's timezone. `new Date(y, m, d)` builds in the runtime's zone, which
 * is what the function reads.
 */

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
const local = (iso) => new Date(iso);

/** Friday, Saturday, Sunday and Monday of the same week in June 2026:
 *  the 5th is a Friday, so 6th Sat, 7th Sun, 8th Mon, and the 3rd a Wednesday. */
describe('the window is Friday 00:00 to Monday 00:00', () => {
  test('from midweek, it points at the Friday coming', () => {
    const { from, to } = weekendRange(at(2026, 6, 3));   // Wednesday
    expect(local(from).getDay()).toBe(5);                 // Friday
    expect(local(from).getDate()).toBe(5);
    expect(local(to).getDate()).toBe(8);                  // Monday
  });

  test('it starts at midnight and runs exactly three days', () => {
    const { from, to } = weekendRange(at(2026, 6, 3));
    const start = local(from);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect(local(to) - start).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe('asked ON the weekend, it means THIS one', () => {
  test('Friday evening still includes tonight', () => {
    // The failure this pins: rolling forward to next Friday hides the event
    // somebody is standing outside, at the moment they are looking for it.
    const { from, to } = weekendRange(at(2026, 6, 5, 20));  // Friday 8pm
    expect(local(from).getDate()).toBe(5);
    expect(local(to).getDate()).toBe(8);
  });

  test('Saturday looks back to yesterday, not forward a week', () => {
    const { from, to } = weekendRange(at(2026, 6, 6));      // Saturday
    expect(local(from).getDate()).toBe(5);
    expect(local(to).getDate()).toBe(8);
  });

  test('Sunday is the end of this weekend, not the start of the next', () => {
    // Sunday is the case a naive `(5 - day + 7) % 7` gets wrong: it reads
    // Sunday as five days before Friday and jumps the whole window forward.
    const { from, to } = weekendRange(at(2026, 6, 7));      // Sunday
    expect(local(from).getDate()).toBe(5);
    expect(local(to).getDate()).toBe(8);
  });

  test('Monday has moved on to the next weekend', () => {
    const { from } = weekendRange(at(2026, 6, 8));          // Monday
    expect(local(from).getDay()).toBe(5);
    expect(local(from).getDate()).toBe(12);
  });
});

describe('across boundaries', () => {
  test('a weekend that spans the end of a month still lands on a Friday', () => {
    // 2026-07-31 is a Friday, so the window runs into August.
    const { from, to } = weekendRange(at(2026, 7, 29));     // Wednesday
    expect(local(from).getDay()).toBe(5);
    expect(local(from).getMonth()).toBe(6);                 // July
    expect(local(to).getMonth()).toBe(7);                   // August
  });

  test('every day of the week produces a Friday start and a Monday end', () => {
    for (let d = 1; d <= 14; d += 1) {
      const { from, to } = weekendRange(at(2026, 6, d));
      expect(local(from).getDay(), `day ${d}`).toBe(5);
      expect(local(to).getDay(), `day ${d}`).toBe(1);
      expect(local(to) > local(from), `day ${d}`).toBe(true);
    }
  });
});
