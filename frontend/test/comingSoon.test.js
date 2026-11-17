import { describe, it, expect } from 'vitest';
import {
  isComingSoon, monthRange, monthOf, thisMonth, formatYm, formatMonth, comingSoonLabel,
} from '../src/app/lib/comingSoon';

describe('coming-soon rough dates', () => {
  it('stores a month as the whole month at the venue', () => {
    // Toronto: EST on March 1, EDT by March 31.
    expect(monthRange('2027-03', 'America/Toronto')).toEqual({
      startsAt: '2027-03-01T05:00:00.000Z',
      endsAt: '2027-04-01T03:59:00.000Z',
    });
    // Leap-year February ends on the 29th.
    expect(monthRange('2028-02', 'UTC').endsAt).toBe('2028-02-29T23:59:00.000Z');
  });

  it('refuses what is not a month', () => {
    expect(monthRange('', 'UTC')).toEqual({ startsAt: null, endsAt: null });
    expect(monthRange('2027-13', 'UTC')).toEqual({ startsAt: null, endsAt: null });
    expect(monthRange('March', 'UTC')).toEqual({ startsAt: null, endsAt: null });
  });

  it('reads the month back at the venue, not in the browser', () => {
    const event = { startsAt: '2027-03-01T05:00:00.000Z', timezone: 'America/Toronto' };
    expect(monthOf(event)).toBe('2027-03');
    // The same instant is still February in Los Angeles.
    expect(monthOf({ ...event, timezone: 'America/Los_Angeles' })).toBe('2027-02');
  });

  it('names it the way a person says it', () => {
    expect(formatYm('2027-03')).toBe('March 2027');
    expect(formatYm('2027-03', { style: 'short' })).toBe('Mar 2027');
    const event = { comingSoon: true, startsAt: '2027-03-01T05:00:00.000Z', timezone: 'America/Toronto' };
    expect(formatMonth(event)).toBe('March 2027');
    expect(comingSoonLabel(event)).toBe('Coming soon · March 2027');
    expect(comingSoonLabel({ comingSoon: true })).toBe('Coming soon');
  });

  it('knows a teaser by either spelling', () => {
    expect(isComingSoon({ comingSoon: true })).toBe(true);
    expect(isComingSoon({ coming_soon: true })).toBe(true);
    expect(isComingSoon({ comingSoon: false })).toBe(false);
    expect(isComingSoon(null)).toBe(false);
  });

  it('starts from this month at the venue', () => {
    // 03:00 UTC on April 1 is still March 31 in Toronto.
    expect(thisMonth('America/Toronto', new Date('2027-04-01T03:00:00Z'))).toBe('2027-03');
  });
});
