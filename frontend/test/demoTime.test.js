import { describe, test, expect } from 'vitest';
import {
  dateIn, groupByDate, timeLabel, spanLabel, monthGrid, monthRange, shiftMonth, offsetLabel, zoneLabel, hostCalendar, googleCalendarUrl,
} from '../src/app/lib/demoTime';

/**
 * Book a demo's display clock (2026-11-19). The API sends instants; the page
 * shows them on the visitor's chosen day and time. The cases that matter are
 * the ones where the zone moves an instant onto another day.
 */
describe('demoTime', () => {
  test('an instant lands on the visitor\'s own day', () => {
    const iso = '2026-11-24T03:30:00.000Z';
    expect(dateIn(iso, 'America/Toronto')).toBe('2026-11-23');
    expect(dateIn(iso, 'Africa/Cairo')).toBe('2026-11-24');
  });

  test('grouping by day follows the zone', () => {
    const slots = ['2026-11-24T03:30:00.000Z', '2026-11-23T15:00:00.000Z', '2026-11-23T14:30:00.000Z'];
    expect(groupByDate(slots, 'America/Toronto')).toEqual({
      '2026-11-23': ['2026-11-23T14:30:00.000Z', '2026-11-23T15:00:00.000Z', '2026-11-24T03:30:00.000Z'],
    });
    expect(Object.keys(groupByDate(slots, 'Africa/Cairo'))).toEqual(['2026-11-23', '2026-11-24']);
  });

  test('times and spans read in the zone', () => {
    expect(timeLabel('2026-11-23T15:30:00.000Z', 'Africa/Cairo')).toBe('5:30 PM');
    expect(spanLabel('2026-11-23T15:30:00.000Z', '2026-11-23T16:00:00.000Z', 'Africa/Cairo'))
      .toBe('5:30 PM – 6:00 PM, Mon, Nov 23, 2026');
  });

  test('the month grid: Sunday first, padded to whole weeks', () => {
    const weeks = monthGrid(2026, 11);
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    const feb = monthGrid(2026, 2);
    expect(feb[0].indexOf('2026-02-01')).toBe(0);
  });

  test('the fetch range covers a day either side; months roll over years', () => {
    expect(monthRange(2026, 12)).toEqual({ from: '2026-11-30T00:00:00.000Z', to: '2027-01-02T00:00:00.000Z' });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  test('zone labels carry the offset at that moment', () => {
    expect(offsetLabel('Africa/Cairo', new Date('2026-11-23T12:00:00Z'))).toBe('GMT+02:00');
    expect(offsetLabel('UTC', new Date('2026-11-23T12:00:00Z'))).toBe('GMT+00:00');
    expect(zoneLabel('America/New_York', new Date('2026-11-23T12:00:00Z'))).toBe('America/New York (GMT-05:00)');
    expect(offsetLabel('Not/AZone')).toBe('');
  });

  test('the card starts on the host\'s today, and the horizon counts calendar days', () => {
    const at = new Date('2026-11-20T02:00:00Z'); // still the 19th in Toronto
    expect(hostCalendar({ timezone: 'America/Toronto', maxDaysAhead: 30 }, at)).toEqual({
      today: '2026-11-19', initialMonth: { year: 2026, month: 11 }, horizonDate: '2026-12-19',
    });
  });

  test('the Google Calendar link', () => {
    const url = new URL(googleCalendarUrl({ start: '2026-11-23T15:30:00Z', end: '2026-11-23T16:00:00Z', title: 'Demo' }));
    expect(url.searchParams.get('dates')).toBe('20261123T153000Z/20261123T160000Z');
    expect(url.searchParams.get('text')).toBe('Demo');
  });
});
