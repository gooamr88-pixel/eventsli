import { describe, it, expect } from 'vitest';
import {
  TIME_ZONES, ALL_LISTED_ZONES, defaultTimeZone, zonesFor, zoneOptions, zoneLabel, zoneOffset, isTimeZone,
} from '../src/app/lib/timezones';
import { toIso, toLocalInput, formatEventTime } from '../src/app/lib/eventTime';

const flat = (groups) => groups.flatMap((g) => g.options.map(([z]) => z));

describe('timezones', () => {
  it('lists only zones this runtime can format in', () => {
    for (const zone of ALL_LISTED_ZONES) {
      expect(isTimeZone(zone), zone).toBe(true);
    }
  });

  it('lists every zone once', () => {
    expect(new Set(ALL_LISTED_ZONES).size).toBe(ALL_LISTED_ZONES.length);
  });

  it('offers the whole world, not only the market country', () => {
    // The bug: a Canadian or US market could only pick North American zones,
    // so an event at a Sydney venue was stored on Toronto time.
    const zones = flat(zoneOptions('CA', 'America/Toronto'));
    for (const zone of ['Australia/Sydney', 'Australia/Perth', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'Asia/Tokyo']) {
      expect(zones).toContain(zone);
    }
  });

  it('puts the market country first', () => {
    expect(zoneOptions('US', 'America/Chicago')[0].label).toBe('United States');
    expect(zoneOptions('CA', 'America/Toronto')[0].label).toBe('Canada');
  });

  it('always offers the current value, even one outside the table', () => {
    // A zone Google returns for a venue, or an older event's value. A select
    // whose value is not an option quietly shows (and saves) the first one.
    const groups = zoneOptions('CA', 'Australia/Eucla');
    expect(groups[0].label).toBe('Current');
    expect(flat(groups)).toContain('Australia/Eucla');
  });

  it('names the offset in each option', () => {
    const at = new Date('2026-01-15T00:00:00Z'); // southern summer: Sydney is +11
    const sydney = zoneOptions('CA', null, at).flatMap((g) => g.options).find(([z]) => z === 'Australia/Sydney');
    expect(sydney[1]).toMatch(/Sydney.*GMT\+11/);
    expect(zoneOffset('Asia/Kathmandu', at)).toBe('GMT+5:45');
  });

  it("defaults to the organizer's own zone wherever it is", () => {
    expect(defaultTimeZone('CA', 'America/Vancouver')).toBe('America/Vancouver');
    expect(defaultTimeZone('US', 'America/Chicago')).toBe('America/Chicago');
    // Used to be replaced by Toronto / New York.
    expect(defaultTimeZone('CA', 'Australia/Sydney')).toBe('Australia/Sydney');
    expect(defaultTimeZone('US', 'Europe/London')).toBe('Europe/London');
  });

  it('falls back to the market only when the browser gives no usable zone', () => {
    expect(defaultTimeZone('CA', null)).toBe('America/Toronto');
    expect(defaultTimeZone('US', 'Not/AZone')).toBe('America/New_York');
    expect(defaultTimeZone('XX', null)).toBe('UTC');
  });

  it('keeps the market lists for the market countries', () => {
    expect(zonesFor('CA')).toBe(TIME_ZONES.CA);
    expect(zonesFor('XX')).toEqual([]);
  });

  it('names zones the way a hint reads them', () => {
    expect(zoneLabel('America/Toronto')).toBe('Eastern time');
    expect(zoneLabel('Australia/Sydney')).toBe('Sydney time');
    expect(zoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires time');
  });
});

describe('an event outside North America keeps its time', () => {
  it('8 pm at a Sydney venue is 8 pm in Sydney, not in Toronto', () => {
    // January: AEDT, UTC+11.
    const iso = toIso('2027-01-20T20:00', 'Australia/Sydney');
    expect(iso).toBe('2027-01-20T09:00:00.000Z');
    expect(toLocalInput(iso, 'Australia/Sydney')).toBe('2027-01-20T20:00');
    expect(formatEventTime(iso, 'Australia/Sydney')).toMatch(/Jan 20, 2027.*8:00\s?PM/);

    // What the old Toronto fallback stored for the same "8 pm": 16 hours later.
    const wrong = toIso('2027-01-20T20:00', 'America/Toronto');
    expect((new Date(wrong) - new Date(iso)) / 3600e3).toBe(16);
  });

  it('round-trips in zones with unusual offsets and southern daylight saving', () => {
    for (const [zone, local] of [
      ['Australia/Adelaide', '2026-10-04T09:30'], // +10:30, the day after DST starts
      ['Asia/Kolkata', '2026-11-20T19:30'],       // +5:30
      ['Asia/Kathmandu', '2026-12-31T23:45'],     // +5:45
      ['Pacific/Chatham', '2027-02-01T18:00'],    // +13:45
      ['Pacific/Kiritimati', '2026-11-11T08:00'], // +14
      ['Europe/London', '2026-03-29T12:00'],      // BST starts that morning
    ]) {
      expect(toLocalInput(toIso(local, zone), zone), `${zone} ${local}`).toBe(local);
    }
  });
});
