import { describe, test, expect } from 'vitest';
import {
  dateOnlyRange, isDateOnly, formatDateOnly, dateOnlyDays, todayAt,
} from '../src/app/lib/dateOnly';
import { problemsFor, initialForm } from '../src/app/organizer/events/new/wizardModel';
import { eventJsonLd, whenPhrase, quickAnswers } from '../src/app/lib/eventSeo';
import { savePlan, formFromDraft } from '../src/app/organizer/events/new/ai/aiDraftModel';
import { RESULT } from './aiDraftFixture';

/**
 * Display-only listings have a date, not a time. Stored as the whole day(s) at
 * the venue, and read back — everywhere — as a date with no time.
 */
const TZ = 'America/Toronto';

describe('the stored shape', () => {
  test('one day is 00:00 to 23:59 at the venue; several days end on the last', () => {
    expect(dateOnlyRange('2026-05-16', '', TZ)).toEqual({ startsAt: '2026-05-16T04:00:00.000Z', endsAt: '2026-05-17T03:59:00.000Z' });
    expect(dateOnlyRange('2026-05-16', '2026-05-18', TZ).endsAt).toBe('2026-05-19T03:59:00.000Z');
    expect(dateOnlyRange('2026-05-16', '2026-05-10', TZ).endsAt, 'a last day before the first is the first').toBe('2026-05-17T03:59:00.000Z');
    expect(dateOnlyRange('', '', TZ)).toEqual({ startsAt: null, endsAt: null });
  });

  test('only a display-only event in exactly that shape is date-only', () => {
    const range = dateOnlyRange('2026-05-16', '2026-05-18', TZ);
    expect(isDateOnly({ displayOnly: true, timezone: TZ, ...range })).toBe(true);
    expect(isDateOnly({ listingType: 'display_only', timezone: TZ, ...range })).toBe(true);
    expect(isDateOnly({ displayOnly: false, timezone: TZ, ...range }), 'a ticket is always for a time').toBe(false);
    expect(isDateOnly({ displayOnly: true, timezone: TZ, startsAt: '2026-05-16T23:00:00Z', endsAt: '2026-05-17T03:00:00Z' })).toBe(false);
  });
});

describe('how it reads', () => {
  const one = { displayOnly: true, timezone: TZ, ...dateOnlyRange('2026-05-16', '', TZ) };
  const three = { displayOnly: true, timezone: TZ, ...dateOnlyRange('2026-05-16', '2026-05-18', TZ) };
  const across = { displayOnly: true, timezone: TZ, ...dateOnlyRange('2026-05-30', '2026-06-02', TZ) };

  test('as a day, or a range of days, never a midnight', () => {
    expect(formatDateOnly(one)).toBe('Saturday, May 16, 2026');
    expect(formatDateOnly(one, { style: 'short' })).toBe('Sat, May 16');
    expect(formatDateOnly(three)).toBe('May 16 – 18, 2026');
    expect(formatDateOnly(across)).toBe('May 30 – June 2, 2026');
    const newYear = { displayOnly: true, timezone: TZ, ...dateOnlyRange('2026-12-30', '2027-01-02', TZ) };
    expect(formatDateOnly(newYear)).toBe('December 30, 2026 – January 2, 2027');
    expect(dateOnlyDays(three)).toEqual({ first: '2026-05-16', last: '2026-05-18' });
  });

  test('to search engines, as dates — and in the description and answers, without a time', () => {
    const ld = eventJsonLd({ ...three, slug: 'fair', title: 'Spring Fair', tiers: [] }, { origin: 'https://eventsli.com' });
    expect(ld.startDate).toBe('2026-05-16');
    expect(ld.endDate).toBe('2026-05-18');
    expect(whenPhrase(three)).toBe('May 16 – 18');
    expect(quickAnswers({ ...one, title: 'Spring Fair' })[0].a).toBe('Spring Fair is on Saturday, May 16, 2026.');
  });
});

describe('what the organizer must give', () => {
  const NOW = new Date('2026-05-01T12:00:00Z');
  const listing = (over = {}) => ({ ...initialForm({ type: 'display_only' }).form, title: 'Spring Fair', timezone: TZ, ...over });

  test('a listing needs a date — no times — and only the city of the where', () => {
    const p = problemsFor({ form: listing({ firstDay: '2099-05-16' }), choices: [], type: 'display_only' });
    expect(p.startsAt).toBeNull();
    expect(p.endsAt).toBeNull();
    expect(p.venueName).toBeNull();
    expect(p.venueAddress).toBeNull();
    expect(p.city).toMatch(/city/);
  });

  test('today counts; yesterday does not; a last day before the first does not', () => {
    const today = todayAt(TZ);
    expect(problemsFor({ form: listing({ firstDay: today }), choices: [], type: 'display_only' }).startsAt).toBeNull();
    expect(problemsFor({ form: listing({ firstDay: '2020-01-01' }), choices: [], type: 'display_only' }).startsAt).toMatch(/today or later/);
    expect(problemsFor({ form: listing({ firstDay: '2099-05-16', lastDay: '2099-05-10' }), choices: [], type: 'display_only' }).endsAt).toMatch(/on or after/);
    expect(problemsFor({ form: listing(), choices: [], type: 'display_only' }).startsAt).toMatch(/Choose the date/);
  });

  test('a ticketed event still needs its times and its venue', () => {
    const p = problemsFor({ form: { ...listing(), firstDay: '2026-05-16' }, choices: [], type: 'ticketed' });
    expect(p.startsAt).toMatch(/when it starts/);
    expect(p.venueName).toMatch(/venue name/);
  });

  test('an AI-drafted listing saves as whole days', () => {
    const form = { ...formFromDraft(RESULT, {}), listingType: 'display_only', firstDay: '2026-11-07', lastDay: '' };
    const plan = savePlan(form, []);
    expect(isDateOnly({ displayOnly: true, timezone: form.timezone, ...plan.event })).toBe(true);
    expect(NOW).toBeTruthy();
  });
});
