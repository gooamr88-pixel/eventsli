import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatMapCanvas from '../src/app/components/seating/SeatMapCanvas';
import { tablePaint, CHAIR } from '../src/app/components/seating/mapStyle';
import { tableTint, studioColours } from '../src/app/components/venue/venueModel';
import TablePanel from '../src/app/organizer/events/[id]/map/TablePanel';
import SelectionPanel from '../src/app/organizer/events/[id]/map/SelectionPanel';
import { useStudioDraft } from '../src/app/organizer/events/[id]/map/studio/useStudioDraft';
import { EventProvider } from '../src/app/organizer/events/[id]/EventContext';
import { forgetSections } from '../src/app/components/inspector/Inspector';

/**
 * The seating map changes of 2026-11-24 (owner's list):
 *   1. private tables are ON the map, marked Private, and pressing one asks
 *      for its password instead of choosing it;
 *   3. a whole table can be marked Unavailable (sold outside Eventsli);
 *   4. many tables can be made private in one action;
 *   5–6. one colour rule everywhere: chairs at tables black, tables in their
 *      own colour → category → ticket type → look.
 */

const table = (over = {}) => ({
  id: 't1', label: 'A1', seatCount: 4, priceCents: 20000, shape: 'round', status: 'available',
  canBookWhole: true, isPrivate: false, position: { x: 50, y: 50, rotation: 0 }, ...over,
});
const seatsFor = (tableId, available = [true, true, true, true]) => available.map((ok, i) => ({
  id: `${tableId}-s${i + 1}`, tableId, number: String(i + 1), priceCents: 5000, available: ok, tierId: null,
}));
const dots = (container) => [...container.querySelectorAll('circle.es-seat-dot')];
const withEvent = (ui) => render(
  <EventProvider value={{ eventId: 'e1', event: { id: 'e1', currency: 'USD', slug: 'gala' } }}>{ui}</EventProvider>,
);

beforeEach(() => { window.localStorage.clear(); forgetSections(); });

describe('the colour rules (mapStyle + venueModel)', () => {
  test('a table is its own colour, then its category, then its ticket type, then the look', () => {
    const tiers = [{ id: 'vip', priceCents: 9000 }, { id: 'std', priceCents: 4000 }];
    const categories = [{ id: 'gold', name: 'Gold', color: '#d4a017' }];
    const tables = [
      { id: 'a', tierId: 'vip', categoryId: 'gold', style: { fill: '#123456' } },
      { id: 'b', tierId: 'vip', categoryId: 'gold' },
      { id: 'c', tierId: 'std' },
      { id: 'd' },
    ];
    const tint = tableTint({ tiers, tables, categories });
    const look = { table: '#8c8c8c', label: '#10303d' };
    expect(tablePaint(tables[0], look, { fill: tint(tables[0]) }).fill).toBe('#123456');
    expect(tablePaint(tables[1], look, { fill: tint(tables[1]) }).fill).toBe('#d4a017');
    // Two ticket types on the map: the table takes its type's colour.
    expect(tint(tables[2])).toMatch(/^#[0-9a-f]{6}$/);
    expect(tint(tables[2])).not.toBe(tint({ tierId: 'vip' }));
    // Nothing assigned: the look's table colour, with the look's label.
    expect(tablePaint(tables[3], look, { fill: tint(tables[3]) })).toMatchObject({ fill: '#8c8c8c', label: '#10303d' });
  });

  test('one ticket type on the map paints no table by type', () => {
    const tint = tableTint({ tiers: [{ id: 'std' }], tables: [{ id: 'a', tierId: 'std' }, { id: 'b', tierId: 'std' }] });
    expect(tint({ id: 'a', tierId: 'std' })).toBeNull();
  });

  test('the 3D views paint chairs at tables black and table tops their colour', () => {
    const c = studioColours({ tables: [{ id: 'a', categoryId: 'g' }], categories: [{ id: 'g', color: '#00aa00' }] });
    expect(c.colorFor({ atTable: true, tableId: 'a' })).toBe(CHAIR);
    expect(c.bodyColor({ id: 'a' })).toBe('#00aa00');
  });
});

describe('the buyer map — chairs and tables', () => {
  test('every chair round a table is black, whatever the ticket type or look', () => {
    const { container } = render(
      <SeatMapCanvas
        tables={[table()]} seats={seatsFor('t1')}
        look={{ seat: '#d6006e', table: '#8c8c8c' }}
        seatFill={() => '#e5b22f'}
      />,
    );
    expect(dots(container).map((d) => d.getAttribute('fill'))).toEqual([CHAIR, CHAIR, CHAIR, CHAIR]);
  });

  test('a taken chair stays black, faded rather than recoloured', () => {
    const { container } = render(<SeatMapCanvas tables={[table()]} seats={seatsFor('t1', [true, false, true, true])} />);
    const [open, taken] = dots(container);
    expect(taken.getAttribute('fill')).toBe(CHAIR);
    expect(Number(taken.getAttribute('opacity'))).toBeLessThan(Number(open.getAttribute('opacity')));
  });

  test('the table body takes its assigned colour', () => {
    const { container } = render(
      <SeatMapCanvas purchaseMode="seat_and_table" tables={[table()]} seats={seatsFor('t1')} tableTint={() => '#d4a017'} />,
    );
    expect(container).toBeTruthy();
    expect(screen.getByRole('button', { name: /Book table A1 whole/ }).getAttribute('fill')).toBe('#d4a017');
  });
});

describe('the buyer map — private tables', () => {
  test('a locked private table is drawn and marked Private, and its seats cannot be chosen', async () => {
    const onSelectSeat = vi.fn();
    const onSelectTable = vi.fn();
    const onLockedTable = vi.fn();
    render(
      <SeatMapCanvas
        purchaseMode="seat_and_table"
        tables={[table({ isPrivate: true, locked: true, canBookWhole: false, priceCents: null })]}
        seats={seatsFor('t1', [false, false, false, false]).map((s) => ({ ...s, reason: 'private' }))}
        onSelectSeat={onSelectSeat} onSelectTable={onSelectTable} onLockedTable={onLockedTable}
      />,
    );
    expect(screen.getByText('Private')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Private table A1/ }));
    expect(onLockedTable).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    // A chair at it asks for the password too, and nothing was chosen.
    await userEvent.click(screen.getAllByRole('button', { name: /private table A1/ })[1]);
    expect(onLockedTable).toHaveBeenCalledTimes(2);
    // ...and hands over WHICH chair, so it is chosen once unlocked (2026-11-24).
    expect(onLockedTable).toHaveBeenLastCalledWith(expect.objectContaining({ id: 't1' }), expect.objectContaining({ tableId: 't1' }));
    expect(onSelectSeat).not.toHaveBeenCalled();
    expect(onSelectTable).not.toHaveBeenCalled();
  });

  test('an unlocked private table is chosen like any other', async () => {
    const onSelectSeat = vi.fn();
    render(<SeatMapCanvas tables={[table({ isPrivate: true, locked: false })]} seats={seatsFor('t1')} onSelectSeat={onSelectSeat} onLockedTable={vi.fn()} />);
    expect(screen.queryByText('Private')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Seat 1, table A1' }));
    expect(onSelectSeat).toHaveBeenCalled();
  });
});

describe('the editor — Unavailable and bulk Private', () => {
  test('a saved table can be marked Unavailable from its inspector', async () => {
    const onSetUnavailable = vi.fn();
    withEvent(
      <TablePanel
        table={{ id: 't1', localKey: 'k1', label: 'T1', shape: 'round', seatCount: 4, position: { x: 1, y: 1, rotation: 0 } }}
        tiers={[]} categories={[]} onChange={() => {}} onRemove={() => {}}
        stock={{ total: 4, open: 4, blocked: 0, booked: 0 }} onSetUnavailable={onSetUnavailable}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Availability/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'Unavailable' }));
    expect(onSetUnavailable).toHaveBeenCalledWith(true);
  });

  test('a new table says to save first', async () => {
    withEvent(
      <TablePanel
        table={{ localKey: 'k1', label: 'T1', shape: 'round', seatCount: 4, position: { x: 1, y: 1, rotation: 0 } }}
        tiers={[]} categories={[]} onChange={() => {}} onRemove={() => {}} onSetUnavailable={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Availability/ }));
    expect(screen.getByText(/Save the map first/)).toBeInTheDocument();
  });

  test('several tables are made private with one password, and public again', async () => {
    const onSetPrivate = vi.fn();
    const tables = [
      { localKey: 'a', label: 'T1', shape: 'round', seatCount: 4, position: { x: 1, y: 1, rotation: 0 } },
      { localKey: 'b', label: 'T2', shape: 'round', seatCount: 4, position: { x: 2, y: 2, rotation: 0 } },
      { localKey: 'c', label: 'T3', shape: 'round', seatCount: 4, position: { x: 3, y: 3, rotation: 0 }, isPrivate: true, hasPassword: true },
    ];
    withEvent(
      <SelectionPanel
        tables={tables} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} onClear={() => {}}
        onSetPrivate={onSetPrivate}
      />,
    );
    const make = screen.getByRole('button', { name: 'Make all 3 private' });
    expect(make).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password for all 3'), 'gala2026');
    await userEvent.click(make);
    expect(onSetPrivate).toHaveBeenCalledWith(true, 'gala2026');
    await userEvent.click(screen.getByRole('button', { name: 'Make it public' }));
    expect(onSetPrivate).toHaveBeenLastCalledWith(false, '');
  });

  test('several saved tables are marked unavailable together', async () => {
    const onSetUnavailable = vi.fn();
    const tables = [
      { id: 't1', localKey: 'a', label: 'T1', shape: 'round', seatCount: 2, position: { x: 1, y: 1, rotation: 0 } },
      { id: 't2', localKey: 'b', label: 'T2', shape: 'round', seatCount: 2, position: { x: 2, y: 2, rotation: 0 } },
    ];
    withEvent(
      <SelectionPanel
        tables={tables} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} onClear={() => {}}
        stockOf={() => ({ total: 2, open: 2, blocked: 0, booked: 0 })} onSetUnavailable={onSetUnavailable}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Availability/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark both unavailable' }));
    expect(onSetUnavailable).toHaveBeenCalledWith(true);
  });
});

describe('useStudioDraft — Unavailable is seat blocks, saved with the map', () => {
  const map = {
    layout: {},
    tables: [
      { id: 't1', seats: [{ id: 's1', status: 'available' }, { id: 's2', status: 'sold' }, { id: 's3', status: 'blocked' }] },
      { id: 't2', seats: [{ id: 's4', status: 'available' }] },
    ],
  };

  test('marking a table unavailable blocks its open seats only, and the reverse releases them', () => {
    const { result } = renderHook(() => useStudioDraft());
    act(() => result.current.load(map));
    act(() => result.current.setTablesUnavailable(['t1'], true));
    expect(result.current.availability()).toEqual({ block: ['s1'], release: [] });
    expect(result.current.tableStock.get('t1')).toEqual({ total: 3, open: 0, blocked: 2, booked: 1 });
    expect(result.current.studioDirty).toBe(true);

    act(() => result.current.setTablesUnavailable(['t1'], false));
    // s1 back to open (its pending block dropped), s3 released.
    expect(result.current.availability()).toEqual({ block: [], release: ['s3'] });
    expect(result.current.tableStock.get('t1').open).toBe(2);
    expect(result.current.tableStock.get('t2').open).toBe(1);
  });
});
