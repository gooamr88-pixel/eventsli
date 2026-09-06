import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatMapCanvas from '../src/app/components/seating/SeatMapCanvas';

/**
 * jsdom has no layout, so nothing here asserts pixels. What it does assert is
 * the behaviour that decides whether someone can buy a seat: which seats are
 * reachable, which are not, and what a click actually reports.
 */

const table = (over = {}) => ({
  id: 't1',
  label: 'A1',
  seatCount: 4,
  priceCents: 20000,
  shape: 'round',
  status: 'available',
  canBookWhole: true,
  isPrivate: false,
  position: { x: 50, y: 50, rotation: 0 },
  ...over,
});

const seatsFor = (tableId, available = [true, true, true, true]) =>
  available.map((ok, i) => ({
    id: `s${i + 1}`,
    tableId,
    number: String(i + 1),
    priceCents: 5000,
    available: ok,
  }));

describe('SeatMapCanvas', () => {
  test('every seat on a table is drawn, in seat-number order', () => {
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} />);
    const buttons = screen.getAllByRole('button', { name: /^Seat \d, table A1/ });
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toHaveAccessibleName('Seat 1, table A1');
    expect(buttons[3]).toHaveAccessibleName('Seat 4, table A1');
  });

  test('seat numbers come from the API, not from the loop index', () => {
    // `seat_number` is TEXT in the database and arrives unsorted from
    // PostgREST. Rendering it by array order puts seat 10 where seat 2 belongs,
    // which is only discovered at the door.
    const shuffled = [
      { id: 'b', tableId: 't1', number: '10', available: true },
      { id: 'a', tableId: 't1', number: '2', available: true },
    ];
    render(<SeatMapCanvas tables={[table({ seatCount: 2 })]} seats={shuffled} />);
    const buttons = screen.getAllByRole('button', { name: /^Seat/ });
    expect(buttons[0]).toHaveAccessibleName('Seat 2, table A1');
    expect(buttons[1]).toHaveAccessibleName('Seat 10, table A1');
  });

  test('a taken seat is not a button at all', () => {
    // Not a disabled button: a disabled control still invites a click and then
    // does nothing. A taken seat is scenery.
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1', [true, false, false, true])} />);
    expect(screen.getAllByRole('button', { name: /^Seat/ })).toHaveLength(2);
  });

  test('clicking a seat reports the seat and its table', async () => {
    const onSelectSeat = vi.fn();
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} onSelectSeat={onSelectSeat} />);

    await userEvent.click(screen.getByRole('button', { name: 'Seat 3, table A1' }));

    expect(onSelectSeat).toHaveBeenCalledOnce();
    const [seat, tbl] = onSelectSeat.mock.calls[0];
    expect(seat.id).toBe('s3');
    expect(tbl.id).toBe('t1');
  });

  test('a selected seat says so to a screen reader', () => {
    render(
      <SeatMapCanvas
        tables={[table()]}
        seats={seatsFor('t1')}
        selectedSeatIds={new Set(['s2'])}
      />,
    );
    const seat = screen.getByRole('button', { name: /Seat 2, table A1, selected/ });
    expect(seat).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SeatMapCanvas — purchase modes', () => {
  test('seat_only offers no whole-table booking', () => {
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} purchaseMode="seat_only" />);
    expect(screen.queryByRole('button', { name: /Book table/ })).toBeNull();
  });

  test('table_only offers the table and not the seats', () => {
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} purchaseMode="table_only" />);
    expect(screen.getByRole('button', { name: 'Book table A1 whole' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Seat/ })).toBeNull();
  });

  test('a table that has gone partial cannot be booked whole', () => {
    // BRD §25 — one seat sold individually closes the whole-table option. The
    // API says so with `canBookWhole`; inferring it from `status` here would be
    // a second opinion that can disagree.
    render(
      <SeatMapCanvas
        tables={[table({ canBookWhole: false, status: 'partial' })]}
        seats={seatsFor('t1', [false, true, true, true])}
        purchaseMode="seat_and_table"
      />,
    );
    expect(screen.queryByRole('button', { name: /Book table/ })).toBeNull();
    // …but its remaining seats are still for sale.
    expect(screen.getAllByRole('button', { name: /^Seat/ })).toHaveLength(3);
  });

  test('a row has no table body to click', () => {
    render(
      <SeatMapCanvas
        tables={[table({ shape: 'row', label: 'Row C' })]}
        seats={seatsFor('t1')}
        purchaseMode="seat_and_table"
      />,
    );
    expect(screen.queryByRole('button', { name: /Book table/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Seat/ })).toHaveLength(4);
  });
});

describe('SeatMapCanvas — degraded data', () => {
  test('a table whose seats have not arrived still draws', () => {
    // A cached map whose seat rows lag, or a seat count changed underneath.
    // Drawing the positions keeps the table's shape honest instead of showing
    // a gap-toothed ring, and none of them is clickable.
    //
    // `purchaseMode` is passed explicitly: it defaults to `seat_only`, matching
    // the column default in the base schema, so omitting it here would test the
    // wrong thing — and did, on the first run.
    render(<SeatMapCanvas tables={[table()]} seats={[]} purchaseMode="seat_and_table" />);
    expect(screen.queryByRole('button', { name: /^Seat/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Book table A1 whole' })).toBeInTheDocument();
  });

  test('the default purchase mode is seat_only, as the schema says', () => {
    // `purchase_mode purchase_mode NOT NULL DEFAULT 'seat_only'`. A component
    // default of anything else would offer whole-table booking on events whose
    // organizer never enabled it.
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} />);
    expect(screen.queryByRole('button', { name: /Book table/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Seat/ })).toHaveLength(4);
  });

  test('an unknown shape does not take the map down with it', () => {
    render(<SeatMapCanvas tables={[table({ shape: 'hexagon' })]} seats={seatsFor('t1')} />);
    expect(screen.getAllByRole('button', { name: /^Seat/ })).toHaveLength(4);
  });

  test('the map controls are reachable and named', () => {
    render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1')} />);
    for (const name of ['Zoom in', 'Zoom out', 'Fit the whole map']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
