import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { googleCalendarUrl, outlookCalendarUrl, icsFile, icsFilename } from '../src/app/lib/calendar';
import OrganizerContactCard from '../src/app/components/OrganizerContactCard';

// Owner, 2026-11-18: on the bought-ticket page — add to calendar, contact the
// organizer, see their profile.

const event = {
  title: 'Starlight Gala, Live', slug: 'starlight-gala',
  startsAt: '2027-03-14T23:00:00.000Z', endsAt: '2027-03-15T02:30:00.000Z',
  venue: { name: 'Roy Thomson Hall', address: '60 Simcoe St, Toronto' },
};

describe('calendar', () => {
  test('Google gets the UTC range, title and place', () => {
    const url = new URL(googleCalendarUrl(event, 'https://eventsli.com/e/starlight-gala'));
    expect(url.searchParams.get('dates')).toBe('20270314T230000Z/20270315T023000Z');
    expect(url.searchParams.get('text')).toBe('Starlight Gala, Live');
    expect(url.searchParams.get('location')).toBe('Roy Thomson Hall, 60 Simcoe St, Toronto');
  });

  test('no end time → a three-hour block; no start → no link at all', () => {
    const url = new URL(googleCalendarUrl({ ...event, endsAt: null }));
    expect(url.searchParams.get('dates')).toBe('20270314T230000Z/20270315T020000Z');
    expect(googleCalendarUrl({ title: 'x' })).toBeNull();
    expect(icsFile({ title: 'x' })).toBeNull();
  });

  test('Outlook gets ISO times', () => {
    const url = new URL(outlookCalendarUrl(event));
    expect(url.searchParams.get('startdt')).toBe('2027-03-14T23:00:00.000Z');
  });

  test('the .ics file is valid: CRLF lines, escaped text, a day-before reminder', () => {
    const ics = icsFile(event, 'https://eventsli.com/e/starlight-gala', new Date('2026-11-18T00:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20270314T230000Z');
    expect(ics).toContain('SUMMARY:Starlight Gala\\, Live');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
    expect(icsFilename(event)).toBe('starlight-gala-live.ics');
  });
});

describe('OrganizerContactCard', () => {
  const organizer = {
    name: 'Starlight Events', slug: 'starlight-events', logoUrl: null,
    contact: { email: 'hello@starlight.ca', phone: null, website: 'https://starlight.ca/' },
    social: [{ key: 'instagram', label: 'Instagram', url: 'https://instagram.com/starlight' }],
  };

  test('shows the profile link and only the published details', () => {
    render(<OrganizerContactCard organizer={organizer} />);
    expect(screen.getByRole('link', { name: /view profile/i }).getAttribute('href')).toBe('/o/starlight-events');
    expect(screen.getByText('hello@starlight.ca')).toBeTruthy();
    expect(screen.getByText('starlight.ca')).toBeTruthy();
    expect(screen.queryByText(/call/i)).toBeNull();
  });

  test('no order token → no message button (only ticket holders can write)', () => {
    render(<OrganizerContactCard organizer={organizer} />);
    expect(screen.queryByRole('button', { name: /message the organizer/i })).toBeNull();
  });

  test('with the order token, the message form opens', () => {
    render(<OrganizerContactCard organizer={organizer} orderToken="order-token-123456789012345" />);
    fireEvent.click(screen.getByRole('button', { name: /message the organizer/i }));
    expect(screen.getByRole('textbox', { name: /message/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /send message/i })).toBeTruthy();
  });

  test('a name alone still renders, as on an event whose organizer has no page yet', () => {
    render(<OrganizerContactCard organizer={null} fallbackName="Old Organizer" />);
    expect(screen.getByText('Old Organizer')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /view profile/i })).toBeNull();
  });
});
