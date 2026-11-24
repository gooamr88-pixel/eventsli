import { describe, test, expect } from 'vitest';
import { dateRange } from '../src/app/organizer/events/eventLook';

/** One night is one date (2026-11-24): 8:30 PM – 1:00 AM read "Dec 11 – 12". */
describe('the event card date', () => {
  const tz = 'America/Chicago';
  test('an evening that ends after midnight shows its start date', () => {
    expect(dateRange({ startsAt: '2026-12-12T02:30:00Z', endsAt: '2026-12-12T07:00:00Z', timezone: tz })).toBe('Dec 11, 2026');
  });
  test('a real multi-day event keeps its range', () => {
    expect(dateRange({ startsAt: '2026-12-11T16:00:00Z', endsAt: '2026-12-13T04:00:00Z', timezone: tz })).toMatch(/Dec 11\s*–\s*12, 2026/);
  });
  test('a same-day event shows one date', () => {
    expect(dateRange({ startsAt: '2026-12-11T16:00:00Z', endsAt: '2026-12-11T22:00:00Z', timezone: tz })).toBe('Dec 11, 2026');
  });
});
