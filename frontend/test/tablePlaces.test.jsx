import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatMapCanvas from '../src/app/components/seating/SeatMapCanvas';
import {
  freeSeatsByTable, tapTable, setGuests, partySeatIds, pickPrice, picksFromSeatIds, seated,
} from '../src/app/e/[slug]/seats/tablePlaces';
import { sellsWholeTables, pricesSeats, isTablePlaces, PURCHASE_MODE_LABELS } from '../src/app/lib/purchaseModes';

/**
 * PLACES AT A TABLE (2026-11-25): the party rules, and the map in that mode â€”
 * a chair chooses its table, a table says how many places are left, and no
 * seat is ever offered on its own.
 */

const seat = (id, tableId, number, available = true, priceCents = 5000) => ({ id, tableId, number: String(number), available, priceCents });
const seats = [
  seat('a1', 'A', 1), seat('a2', 'A', 2), seat('a3', 'A', 3, false), seat('a4', 'A', 4),
  seat('b10', 'B', 10, true, 7000), seat('b2', 'B', 2, true, 6000),
];
const free = freeSeatsByTable(seats);
const freeOf = (id) => (free.get(id) || []).length;

describe('the party', () => {
  test('free seats are taken lowest number first, as the server takes them', () => {
    expect(free.get('A').map((s) => s.id)).toEqual(['a1', 'a2', 'a4']);
    expect(free.get('B').map((s) => s.id)).toEqual(['b2', 'b10']);
  });

  test('a tapped table seats the party, as many as it has room for', () => {
    expect(tapTable([], 2, 'A', 3)).toEqual([{ tableId: 'A', quantity: 2 }]);
    expect(tapTable([], 5, 'A', 3)).toEqual([{ tableId: 'A', quantity: 3 }]);
  });

  test('the rest of the party goes to the next table tapped', () => {
    const first = tapTable([], 5, 'A', 3);
    expect(tapTable(first, 5, 'B', 2)).toEqual([{ tableId: 'A', quantity: 3 }, { tableId: 'B', quantity: 2 }]);
  });

  test('with everyone seated, another table moves the party there', () => {
    const at = tapTable([], 2, 'A', 3);
    expect(tapTable(at, 2, 'B', 2)).toEqual([{ tableId: 'B', quantity: 2 }]);
  });

  test('a chosen table tapped again is given back; a full one does nothing', () => {
    const at = tapTable([], 2, 'A', 3);
    expect(tapTable(at, 2, 'A', 3)).toEqual([]);
    expect(tapTable([], 2, 'C', 0)).toEqual([]);
  });

  test('one more guest joins the last table while it has room; one fewer leaves it', () => {
    const at = [{ tableId: 'A', quantity: 2 }];
    expect(setGuests(at, 3, freeOf)).toEqual([{ tableId: 'A', quantity: 3 }]);
    // A has 3 free places: the fourth guest waits for another table.
    expect(setGuests([{ tableId: 'A', quantity: 3 }], 4, freeOf)).toEqual([{ tableId: 'A', quantity: 3 }]);
    expect(setGuests([{ tableId: 'A', quantity: 3 }, { tableId: 'B', quantity: 2 }], 2, freeOf)).toEqual([{ tableId: 'A', quantity: 2 }]);
  });

  test('the chairs drawn as the party, and what the places cost', () => {
    const picks = [{ tableId: 'A', quantity: 2 }, { tableId: 'B', quantity: 1 }];
    expect([...partySeatIds(picks, free)]).toEqual(['a1', 'a2', 'b2']);
    expect(pickPrice({ tableId: 'B', quantity: 2 }, free)).toBe(13000);
    expect(pickPrice({ tableId: 'A', quantity: 9 }, free)).toBeNull();
    expect(seated(picks)).toBe(3);
  });

  test('the cartâ€™s held seats come back as the party', () => {
    expect(picksFromSeatIds(['a1', 'a2', 'b10'], seats)).toEqual([{ tableId: 'A', quantity: 2 }, { tableId: 'B', quantity: 1 }]);
  });
});

describe('the modes', () => {
  test('places at a table never sells a table whole, and prices seats by type', () => {
    expect(sellsWholeTables('table_places')).toBe(false);
    expect(sellsWholeTables('seat_and_table')).toBe(true);
    expect(pricesSeats('table_places')).toBe(true);
    expect(pricesSeats('table_only')).toBe(false);
    expect(isTablePlaces('table_places')).toBe(true);
    expect(PURCHASE_MODE_LABELS.table_places).toBe('Places at a table');
  });
});

describe('the map, places at a table', () => {
  const table = (over = {}) => ({
    id: 't1', label: 'Gala', seatCount: 4, priceCents: 40000, shape: 'round', status: 'available',
    canBookWhole: false, isPrivate: false, position: { x: 50, y: 50, rotation: 0 }, ...over,
  });
  const chairs = (available) => available.map((ok, i) => seat(`s${i + 1}`, 't1', i + 1, ok));

  test('the table is the control, named by its places left; no chair is a control of its own', () => {
    render(<SeatMapCanvas tables={[table()]} seats={chairs([true, false, true, true])} purchaseMode="table_places" />);
    expect(screen.getByRole('button', { name: 'Choose table Gala, 3 places left' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^Seat/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Book table/ })).toBeNull();
    expect(screen.getByText('3 left')).toBeInTheDocument();
  });

  test('pressing the table â€” or any chair at it, even a taken one â€” chooses the table', async () => {
    const onSelectTable = vi.fn();
    const onSelectSeat = vi.fn();
    const { container } = render(
      <SeatMapCanvas tables={[table()]} seats={chairs([false, true, true, true])} purchaseMode="table_places"
        onSelectTable={onSelectTable} onSelectSeat={onSelectSeat} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Choose table Gala/ }));
    // The first chair is taken; it still stands for its table.
    await userEvent.click(container.querySelectorAll('circle.es-seat-hit')[0]);
    expect(onSelectTable).toHaveBeenCalledTimes(2);
    expect(onSelectTable.mock.calls[0][0].id).toBe('t1');
    expect(onSelectSeat).not.toHaveBeenCalled();
  });

  test('a full table says so and cannot be chosen', () => {
    render(<SeatMapCanvas tables={[table()]} seats={chairs([false, false, false, false])} purchaseMode="table_places" />);
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose table/ })).toBeNull();
  });

  test('the classic modes are unchanged: seats are still buttons there', () => {
    render(<SeatMapCanvas tables={[table()]} seats={chairs([true, true, true, true])} purchaseMode="seat_only" />);
    expect(screen.getAllByRole('button', { name: /^Seat \d, table Gala/ })).toHaveLength(4);
  });
});
