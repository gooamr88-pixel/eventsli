import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketStub, { ticketFacts } from '../src/app/components/TicketStub';

/**
 * The ticket was redrawn to the brand guide on 2026-10-16. These hold the two
 * things that redesign was not allowed to change — what the door staff read,
 * and the code — plus the facts the new layout labels.
 */
const base = { id: 't1', status: 'valid', qr: 'tok', attendeeName: null, transferred: false, table: null, seat: null, scannedAt: null };

describe('ticketFacts', () => {
  test('a reserved seat names section, row and seat, after the ticket type', () => {
    expect(ticketFacts({ ...base, tierName: 'Standard', seat: { section: 'Orchestra', row: 'F', number: 12 } }))
      .toEqual([['Ticket type', 'Standard'], ['Section', 'Orchestra'], ['Row', 'F'], ['Seat', '12']]);
  });

  test('a table booking names the table and the seat, never "Row A"', () => {
    expect(ticketFacts({ ...base, table: 'T3', seat: { section: 'T3', row: 'A', number: 4 } }))
      .toEqual([['Table', 'T3'], ['Seat', '4']]);
  });

  test('a seat sold on its own at a table does not print the filler row', () => {
    const facts = ticketFacts({ ...base, seat: { section: 'T3', row: 'A', number: 4 } });
    expect(facts.find(([k]) => k === 'Row')).toBeUndefined();
  });

  test('general admission says so — once', () => {
    expect(ticketFacts(base)).toEqual([['Admission', 'General admission']]);
    expect(ticketFacts({ ...base, tierName: 'General Admission' })).toEqual([['Ticket type', 'General Admission']]);
    expect(ticketFacts({ ...base, tierName: 'VIP' })).toEqual([['Ticket type', 'VIP'], ['Admission', 'General admission']]);
  });

  test('the holder comes last', () => {
    const facts = ticketFacts({ ...base, attendeeName: 'María González' });
    expect(facts.at(-1)).toEqual(['Name', 'María González']);
  });
});

describe('TicketStub', () => {
  const event = { title: 'Toronto Jazz Night', startsAt: '2026-11-01T23:30:00Z', timezone: 'America/Toronto', venue: { name: 'Massey Hall' } };

  test('the code keeps its white pad and its door size', () => {
    render(<TicketStub ticket={base} event={event} qrSrc="/qr.png" prominent />);
    const img = screen.getByRole('img', { name: /entry code/i });
    expect(img.className).toContain('es-tkt__img');
    expect(img.getAttribute('width')).toBe('288');
    // The teal is on the stub, never behind the code.
    expect(img.closest('.es-tkt__stub')).toBeNull();
  });

  test('a missing code says what to do instead of drawing a broken image', () => {
    render(<TicketStub ticket={base} event={event} qrSrc={null} />);
    expect(screen.getByText(/Code unavailable/)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /entry code/i })).toBeNull();
  });

  test('a used ticket is stamped and dimmed', () => {
    render(<TicketStub ticket={{ ...base, status: 'scanned', scannedAt: '2026-11-01T23:45:00Z' }} event={event} qrSrc="/qr.png" />);
    expect(screen.getByText('Used')).toBeTruthy();
    expect(screen.getByRole('img', { name: /entry code/i }).className).toContain('opacity-30');
  });

  test('the event travels with the ticket, venue given as a name or an object', () => {
    const { rerender } = render(<TicketStub ticket={base} event={event} qrSrc="/qr.png" />);
    expect(screen.getByText('Massey Hall')).toBeTruthy();
    rerender(<TicketStub ticket={base} event={{ ...event, venue: 'Comedy Bar' }} qrSrc="/qr.png" />);
    expect(screen.getByText('Comedy Bar')).toBeTruthy();
    expect(screen.getByText('Toronto Jazz Night')).toBeTruthy();
  });
});
