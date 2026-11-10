import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { pickSeats } from '../src/app/e/[slug]/seats/pickSeats';
import TierDetailsDialog, { hasDetails } from '../src/app/components/tickets/TierDetailsDialog';

const VIP = 'vip';
const seat = (id, row, number, extra = {}) => ({ id, tierId: VIP, tableId: 't1', section: 'A', row, number: String(number), available: true, ...extra });

describe('pickSeats', () => {
  test('a run of free seats side by side, from the line with most free seats', () => {
    const seats = [
      seat('a1', 'A', 1), seat('a2', 'A', 2, { available: false }), seat('a3', 'A', 3),
      seat('b1', 'B', 1), seat('b2', 'B', 2), seat('b3', 'B', 3), seat('b4', 'B', 4),
    ];
    expect(pickSeats(seats, VIP, 3).map((s) => s.id)).toEqual(['b1', 'b2', 'b3']);
  });

  test('the tapped seat comes first, then its nearest free neighbours', () => {
    const seats = [seat('b1', 'B', 1), seat('b2', 'B', 2), seat('b3', 'B', 3), seat('b4', 'B', 4)];
    expect(pickSeats(seats, VIP, 2, new Set(), seats[1]).map((s) => s.id)).toEqual(['b2', 'b3']);
  });

  test('skips seats already chosen and other ticket types, and never invents seats', () => {
    const seats = [seat('a1', 'A', 1), seat('a2', 'A', 2, { tierId: 'other' }), seat('a3', 'A', 3)];
    expect(pickSeats(seats, VIP, 5, new Set(['a1'])).map((s) => s.id)).toEqual(['a3']);
  });
});

describe('TierDetailsDialog', () => {
  const tier = {
    id: 't', name: 'VIP Table Experience', priceCents: 25000, kind: 'vip',
    details: {
      tagline: 'A premium, all-inclusive dining experience',
      included: [{ icon: 'dinner', title: 'A luxurious dinner', text: 'A curated multi-course menu' }],
      notes: [{ icon: 'tag', text: 'All tickets are final sale and non-refundable.' }],
      priceUnit: 'person',
    },
  };

  test('shows the card and hands back the quantity, capped at max', () => {
    const onAdd = vi.fn();
    render(<TierDetailsDialog tier={tier} currency="CAD" max={2} onAdd={onAdd} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'VIP Table Experience' })).toBeTruthy();
    expect(screen.getByText('A luxurious dinner')).toBeTruthy();
    expect(screen.getByText('Price per person')).toBeTruthy();
    const more = screen.getByRole('button', { name: 'One more' });
    fireEvent.click(more);
    expect(more.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }));
    expect(onAdd).toHaveBeenCalledWith(2);
  });

  test('a sold-out type says why and cannot be added', () => {
    render(<TierDetailsDialog tier={tier} currency="CAD" max={0} unavailable="Sold out" onClose={() => {}} />);
    expect(screen.getByText('Sold out')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Not available/ }).disabled).toBe(true);
  });

  test('hasDetails is false for settings without content', () => {
    expect(hasDetails({ details: { showBeforeBuying: true } })).toBe(false);
    expect(hasDetails(tier)).toBe(true);
  });
});
